const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),cp=require('node:child_process');
const root=path.resolve(__dirname,'..'),pkg=path.join(root,'package/luci-app-traffic-monitor'),files=path.join(pkg,'files');
function list(dir,prefix=''){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?list(path.join(dir,e.name),prefix+e.name+'/'):[prefix+e.name]).sort();}
const names=list(files),mk=fs.readFileSync(path.join(pkg,'Makefile'),'utf8');
const installed=[...mk.matchAll(/\$\(INSTALL_(?:BIN|DATA|CONF)\) \.\/files\/([^\s]+) /g)].map(x=>x[1]).sort();
assert.deepEqual(installed,names,'SDK install list must exactly match the standalone payload');
assert(mk.includes('PKG_NAME:=luci-app-traffic-monitor'));
assert(mk.includes('DEPENDS:=+luci-base +nlbwmon +conntrack +rpcd-mod-ucode'));
assert(mk.includes('$${IPKG_INSTROOT}'),'Maintainer scripts must escape make variables');
assert(!names.some(x=>/_v\d+\.(?:js|css)$/.test(x)),'No development-version asset filenames');
for(const name of names){
 const text=fs.readFileSync(path.join(files,name),'utf8');
 assert(!text.includes('\r'),'Installed files must use LF: '+name);
 assert(!/192\.168\.10\.|bc:24:11:|C:\\Users\\|D:\\homelab|PRIVATE KEY|gh[pousr]_[A-Za-z0-9]{20}/i.test(text),'Private deployment content in '+name);
 if(name.endsWith('.json'))JSON.parse(text);
 if(name.endsWith('.js')){
  const r=cp.spawnSync(process.execPath,['--check',path.join(files,name)],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);
  for(const match of text.matchAll(/'require (traffic-monitor\.[^' ]+)(?: as [^']+)?';/g))assert(fs.existsSync(path.join(files,'www/luci-static/resources',match[1].replaceAll('.','/')+'.js')),'Missing LuCI module '+match[1]);
 }
}
const menu=JSON.parse(fs.readFileSync(path.join(files,'usr/share/luci/menu.d/luci-app-traffic-monitor.json'),'utf8'));
assert.equal(menu['admin/services/traffic-monitor/live'].order,1);
for(const item of Object.values(menu))if(item.action?.type==='view')assert(fs.existsSync(path.join(files,'www/luci-static/resources/view',item.action.path+'.js')));
console.log('Source checks passed: '+names.length+' installed files, complete SDK manifest, modules and privacy checks.');
