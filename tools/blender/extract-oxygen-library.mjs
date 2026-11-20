import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { serve } from '../../scripts/lab.mjs';
import { root } from '../../scripts/lab-core.mjs';

const require=createRequire(import.meta.url);
const { chromium }=require(process.env.LAB_PLAYWRIGHT_MODULE || 'playwright');
const source=readFileSync(resolve(root,'lab.js'),'utf8');
const hook="        updateAssembly();\n        assemblyNote('当前：'+nextInstrument().name+'。');";
if(!source.includes(hook))throw new Error('Oxygen apparatus initialization hook changed');

function extract(T, refs) {
  const {
    apparatus, standGroup, standX, standZ, clampCollar, tube, length, chute, cottonTufts, crystals, payload, pipeGroup,
    stopper, stopperLip, holeEdge, sleeveMat, sleeveEdge, pipeGlass, pipeRoute,
    sleeveStart, sleeveEnd, bathPipe, dryPipe, morphTip, morphTube, jarX, jarZ, jarBody,
    tankX, tankZ, tankWater, tankSurface, surfacePatch, rest,
    carriedPlate, lampCap, towel, match, splint, splintFlame
  }=refs;
  const V=(x,y,z)=>new T.Vector3(x,y,z);
  const scale=.1;
  const translate=(x,y,z)=>new T.Matrix4().makeTranslation(x,y,z);
  const rotationZ=a=>new T.Matrix4().makeRotationZ(a);
  const all=(root,filter=()=>true)=>{
    const result=[];
    root.traverse(o=>{if(o.isMesh&&o.geometry.getAttribute('position')&&filter(o))result.push(o);});
    return result;
  };
  const material=(m)=>{
    const glass=m.isShaderMaterial&&!!m.uniforms.tint;
    const c=glass ? m.uniforms.tint.value.clone().lerp(new T.Color(0xf3faff),.78)
      : m.color?.clone() || new T.Color(0xffffff);
    return {glass,color:c.toArray(),alpha:glass?.24:m.transparent?m.opacity:1,
      roughness:glass?.13:m.roughness??.34,metalness:m.metalness??0};
  };
  function asset(id, meshes, transform, anchors={}, version=1){
    const normalMatrix=new T.Matrix3();
    const parts=meshes.map((obj,i)=>{
      const matrix=transform.clone().multiply(obj.matrixWorld);
      normalMatrix.getNormalMatrix(matrix);
      const geo=obj.geometry, pos=geo.getAttribute('position'), norm=geo.getAttribute('normal');
      const positions=[], normals=[], v=V(0,0,0);
      for(let k=0;k<pos.count;k++){
        positions.push(...v.fromBufferAttribute(pos,k).applyMatrix4(matrix).multiplyScalar(scale).toArray());
        if(norm)normals.push(...v.fromBufferAttribute(norm,k).applyNormalMatrix(normalMatrix).toArray());
      }
      return {name:obj.name||id+' part '+(i+1),positions,
        indices:geo.index?Array.from(geo.index.array):null,normals:norm?normals:null,
        ...material(obj.material)};
    });
    if(!parts.length)throw new Error('No mesh for '+id);
    return {id,version,parts,anchors:Object.fromEntries(Object.entries(anchors).map(([key,v])=>[key,v.clone().applyMatrix4(transform).multiplyScalar(scale).toArray()]))};
  }
  const at=(root)=>root.matrixWorld.clone().invert();
  const plug=[stopper,stopperLip,holeEdge], stopperCenter=stopper.getWorldPosition(V(0,0,0));
  const pureTube=all(tube,o=>!cottonTufts.includes(o)&&!crystals.includes(o)&&
    !payload.some(p=>p.grain===o)&&o.parent!==chute);
  const testTubePose=translate(-length*.48,.35,0).multiply(rotationZ(-Math.PI/2)).multiply(at(tube));
  const sleeve=all(pipeGroup,o=>o.material===sleeveMat||o.material===sleeveEdge);
  const glassPipe=all(pipeGroup,o=>!plug.includes(o)&&!sleeve.includes(o)&&
    ![bathPipe.segment,bathPipe.ring,dryPipe.segment,dryPipe.ring,morphTip,morphTube].includes(o)&&o.visible&&
    (o.material===pipeGlass||o.geometry.type==='TorusGeometry'));
  const tank=apparatus.get('tank');
  const tankGlass=all(tank,o=>!o.material.uniforms?.strength?.value&&o.material!==tankWater&&
    o!==tankSurface&&o!==surfacePatch&&o.material!==rest).concat(all(tank,o=>o.material.uniforms?.strength?.value&&o.geometry.type==='ExtrudeGeometry'));
  const rim=apparatus.get('jar').children.filter(o=>o!==jarBody&&o.geometry?.type==='TorusGeometry'&&
    o.position.y!==3.23&&o.position.y!==.448);
  const jarUpright=translate(jarX,3.39,-jarZ).multiply(rotationZ(Math.PI));
  const sleeveCenter=pipeRoute.getPoint((sleeveStart+sleeveEnd)/2);
  const woolCenter=cottonTufts[0].getWorldPosition(V(0,0,0));
  const meshOnly=m=>all(m,o=>o!==splintFlame);
  return {assets:[
    asset('stand',all(standGroup,o=>o.geometry.type!=='PlaneGeometry'),translate(-standX,-.01,-standZ),
      {base:V(standX,.01,standZ),clamp:clampCollar.getWorldPosition(V(0,0,0))},2),
    asset('test-tube',pureTube,testTubePose,{mouth:tube.localToWorld(V(0,length,0)),'closed-end':tube.localToWorld(V(0,-.34,0)),clamp:tube.localToWorld(V(0,1.53,0))}),
    asset('glass-delivery-tube',glassPipe,translate(0,-.22,-.32),{inlet:pipeRoute.getPoint(0),outlet:pipeRoute.getPoint(1),'joint-in':pipeRoute.getPoint(sleeveStart),'joint-out':pipeRoute.getPoint(sleeveEnd)}),
    asset('water-trough',tankGlass,translate(-tankX,-.105,-tankZ),{base:V(tankX,.105,tankZ),rim:V(tankX,.94,tankZ)}),
    asset('gas-jar-rest',all(tank,o=>o.material===rest),translate(-jarX,-.16,-jarZ),
      {base:V(jarX,.16,jarZ),support:V(jarX,.471,jarZ)}),
    asset('gas-jar',[jarBody,...rim],jarUpright,{base:V(jarX,3.39,jarZ),mouth:V(jarX,.48,jarZ)}),
    asset('rubber-stopper',plug,translate(-stopperCenter.x,-stopperCenter.y,-stopperCenter.z),{center:stopperCenter}),
    asset('rubber-connector',sleeve,translate(-sleeveCenter.x,-sleeveCenter.y,-sleeveCenter.z),{inlet:pipeRoute.getPoint(sleeveStart),outlet:pipeRoute.getPoint(sleeveEnd)}),
    asset('glass-plate',all(carriedPlate),at(carriedPlate),{center:carriedPlate.getWorldPosition(V(0,0,0))}),
    asset('lamp-cap',all(lampCap),at(lampCap),{seat:lampCap.getWorldPosition(V(0,0,0))}),
    asset('hot-towel',all(towel),at(towel),{center:towel.getWorldPosition(V(0,0,0))}),
    asset('paper-chute',all(chute),translate(-length*.48,0,0).multiply(rotationZ(-Math.PI/2)).multiply(at(chute)),
      {tip:chute.localToWorld(V(.15,0,0)),handle:chute.localToWorld(V(.15,length+.52,0))}),
    asset('cotton-plug',cottonTufts,translate(-woolCenter.x,-woolCenter.y,-woolCenter.z),{center:woolCenter}),
    asset('matchstick',meshOnly(match),rotationZ(-Math.PI/2).multiply(at(match)),{head:match.getWorldPosition(V(0,0,0))}),
    asset('wooden-splint',meshOnly(splint),rotationZ(-Math.PI/2).multiply(at(splint)),{tip:splint.getWorldPosition(V(0,0,0))})
  ]};
}

const injection='scene.updateMatrixWorld(true); window.__oxygenLibrary = ('+extract.toString()+')(T,{'
  +'apparatus,standGroup,standX,standZ,clampCollar,tube,length,chute,cottonTufts,crystals,payload,pipeGroup,stopper,stopperLip,holeEdge,sleeveMat,sleeveEdge,pipeGlass,pipeRoute,sleeveStart,sleeveEnd,bathPipe,dryPipe,morphTip,morphTube,jarX,jarZ,jarBody,tankX,tankZ,tankWater,tankSurface,surfacePatch,rest,carriedPlate,lampCap,towel,match,splint,splintFlame});\n';
const server=await serve({port:0});
let browser;
try{
  browser=await chromium.launch({
    executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined,
    args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']
  });
  const page=await browser.newPage();
  page.on('pageerror',error=>console.error(error.message));
  page.on('console',message=>{if(message.type()==='error')console.error(message.text());});
  await page.route('**/lab.js',route=>route.fulfill({
    contentType:'text/javascript; charset=utf-8',body:source.replace(hook,injection+hook)
  }));
  await page.goto('http://127.0.0.1:'+server.address().port);
  await page.waitForFunction(()=>!!window.__oxygenLibrary,{timeout:15000});
  const library=await page.evaluate(()=>window.__oxygenLibrary);
  const output=resolve(root,'.lab-output');
  mkdirSync(output,{recursive:true});
  writeFileSync(resolve(output,'oxygen-meshes.json'),JSON.stringify(library));
  console.log(library.assets.map(a=>a.id+': '+a.parts.length+' meshes').join('\n'));
}finally{
  await browser?.close();
  server.close();
}
