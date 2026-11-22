const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),pkg=path.join(root,'package/luci-app-traffic-monitor');
const notice='Modified for Traffic Monitor from luci-app-nlbw-history; see NOTICE.';
function walk(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name)):[path.join(dir,e.name)]);}
for(const file of [...walk(path.join(pkg,'files')),path.join(root,'build-apk.sh'),path.join(root,'tools/pkg-meta.sh')]){
 let text=fs.readFileSync(file,'utf8');if(text.includes(notice))continue;
 if(file.endsWith('.json')){
  const obj=JSON.parse(text);
  if(file.includes('menu.d'))obj['admin/services/traffic-monitor'].description=notice;
  else obj['luci-app-traffic-monitor'].description+=' '+notice;
  text=JSON.stringify(obj,null,2)+'\n';
 }else if(file.endsWith('.js')||file.endsWith('.uc'))text='// '+notice+'\n'+text;
 else if(file.endsWith('.css'))text='/* '+notice+' */\n'+text;
 else if(text.startsWith('#!')){const at=text.indexOf('\n');text=text.slice(0,at+1)+'# '+notice+'\n'+text.slice(at+1);}
 else text='# '+notice+'\n'+text;
 fs.writeFileSync(file,text);
}
