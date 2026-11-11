import {promises as fs,constants} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {launcherHome} from './launcher.mjs';

const exec=promisify(execFile);
const entry=fileURLToPath(new URL('../scripts/yuanxing.mjs',import.meta.url));
const quote=value=>"'"+value.replace(/'/g,"'\\''")+"'";
const appleString=value=>'"'+value.replace(/\\/g,'\\\\').replace(/"/g,'\\"')+'"';
const psString=value=>"'"+value.replace(/'/g,"''")+"'";
export function desktopScript(platform,{node=process.execPath,cli=entry}={}){
  if(platform==='darwin'){
    // Finder 启动不读取交互 shell 的 PATH，沿用安装时的工具路径供项目构建器使用。
    const searchPath=path.dirname(node)+':'+(process.env.PATH||'/usr/bin:/bin:/usr/sbin:/sbin');
    const command=appleString(`PATH=${quote(searchPath)} exec ${quote(node)} ${quote(cli)} open`);
    return `on launchWorkbench()\n  try\n    do shell script ${command}\n  on error messageText\n    display alert "元形工作台" message messageText\n  end try\nend launchWorkbench\non run\n  launchWorkbench()\nend run\non open location incomingURL\n  if incomingURL is "yuanxing://open" or incomingURL is "yuanxing://open/" then launchWorkbench()\nend open location\n`;
  }
  if(platform==='win32')return `$ErrorActionPreference = 'Stop'\ntry {\n  & ${psString(node)} ${psString(cli)} open\n  if ($LASTEXITCODE -ne 0) { throw '元形工作台启动失败，请检查 Node.js 和元形安装位置。' }\n} catch {\n  Add-Type -AssemblyName System.Windows.Forms\n  [System.Windows.Forms.MessageBox]::Show($_.Exception.Message, '元形工作台') | Out-Null\n  exit 1\n}\n`;
  throw new Error('桌面启动器目前支持 macOS 和 Windows。');
}
async function backupOwnedApp(app,home){
  const stat=await fs.lstat(app).catch(error=>{if(error.code==='ENOENT')return null;throw error;});if(!stat)return null;
  if(stat.isSymbolicLink()||!stat.isDirectory())throw new Error('桌面已有同名内容，未覆盖：'+app);
  const {stdout}=await exec('/usr/libexec/PlistBuddy',['-c','Print :CFBundleIdentifier',path.join(app,'Contents/Info.plist')]);
  if(!['local.jasperlin.yuanxing-workbench','org.yuanxing.workbench'].includes(stdout.trim()))throw new Error('桌面已有其他同名应用，未覆盖：'+app);
  const backup=path.join(home,'backups',`元形工作台-${Date.now()}.app`);await fs.mkdir(path.dirname(backup),{recursive:true});await fs.rename(app,backup);return backup;
}
export async function installDesktop({home=launcherHome(),desktop}={}){
  if(!['darwin','win32'].includes(process.platform))throw new Error('桌面启动器目前支持 macOS 和 Windows；其他环境可使用 open 命令。');
  if(!desktop)desktop=process.platform==='win32'?(await exec('powershell.exe',['-NoProfile','-NonInteractive','-Command',"[Environment]::GetFolderPath('Desktop')"])).stdout.trim():path.join(os.homedir(),'Desktop');
  await fs.mkdir(home,{recursive:true});await fs.mkdir(desktop,{recursive:true});
  if(process.platform==='darwin'){
    const app=path.join(desktop,'元形工作台.app'),temporary=await fs.mkdtemp(path.join(home,'desktop-'));
    let backup;
    try{
      const source=path.join(temporary,'launcher.applescript'),built=path.join(temporary,'元形工作台.app');
      await fs.writeFile(source,desktopScript('darwin'));await exec('osacompile',['-o',built,source]);
      const plist=path.join(built,'Contents/Info.plist');
      await exec('/usr/bin/plutil',['-replace','CFBundleIdentifier','-string','org.yuanxing.workbench',plist]);
      for(const command of ['Add :LSUIElement bool true','Add :CFBundleURLTypes array','Add :CFBundleURLTypes:0 dict','Add :CFBundleURLTypes:0:CFBundleURLName string org.yuanxing.workbench','Add :CFBundleURLTypes:0:CFBundleTypeRole string Viewer','Add :CFBundleURLTypes:0:CFBundleURLSchemes array','Add :CFBundleURLTypes:0:CFBundleURLSchemes:0 string yuanxing'])await exec('/usr/libexec/PlistBuddy',['-c',command,plist]);
      backup=await backupOwnedApp(app,home);
      if(backup){
        for(const name of ['applet.icns','AppIcon.icns']){const source=path.join(backup,'Contents/Resources',name);if(await fs.stat(source).catch(()=>null))await fs.copyFile(source,path.join(built,'Contents/Resources',name));}
      }
      await fs.rename(built,app);
      await exec('/usr/bin/codesign',['--force','--sign','-',app]);
      await exec('/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister',['-f',app]);
      return {desktop:app,backup,protocol:'yuanxing://open'};
    }catch(error){
      if(backup){await fs.rm(app,{recursive:true,force:true});await fs.rename(backup,app);}throw error;
    }finally{await fs.rm(temporary,{recursive:true,force:true});}
  }
  const shortcut=path.join(desktop,'元形工作台.lnk');let backup;
  if(await fs.lstat(shortcut).catch(()=>null)){backup=path.join(home,'backups',`元形工作台-${Date.now()}.lnk`);await fs.mkdir(path.dirname(backup),{recursive:true});await fs.copyFile(shortcut,backup,constants.COPYFILE_EXCL);}
  // URI 内容不进入命令行，协议入口始终只打开本机已配置的工作台。
  const args='-NoProfile -NonInteractive -WindowStyle Hidden -EncodedCommand '+Buffer.from(desktopScript('win32'),'utf16le').toString('base64');
  const code=`$ErrorActionPreference = 'Stop'\n$key = 'HKCU:\\Software\\Classes\\yuanxing'\nNew-Item -Path ($key + '\\shell\\open\\command') -Force | Out-Null\nSet-Item -Path $key -Value 'URL:Yuanxing Workbench'\nNew-ItemProperty -Path $key -Name 'URL Protocol' -Value '' -PropertyType String -Force | Out-Null\nSet-Item -Path ($key + '\\shell\\open\\command') -Value ${psString('powershell.exe '+args)}\n$shell = New-Object -ComObject WScript.Shell\n$link = $shell.CreateShortcut(${psString(shortcut)})\n$link.TargetPath = Join-Path $PSHOME 'powershell.exe'\n$link.Arguments = ${psString(args)}\n$link.Description = '打开元形编辑工作台'\n$link.Save()\n`;
  await exec('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(code,'utf16le').toString('base64')]);
  return {desktop:shortcut,backup,protocol:'yuanxing://open'};
}
