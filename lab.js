(() => {
      const root = document.getElementById('oxygen-lab-3d');
      const el = name => root.querySelector('[data-lab="' + name + '"]');
      window.lucide?.createIcons();
      try {
        build(window.THREE);
      } catch (error) {
        el('fallback').textContent = '暂时无法加载 3D 模型，请检查浏览器的 WebGL 设置。';
        console.error(error);
      }

      function build(T) {
        const V = (x,y,z) => new T.Vector3(x,y,z);
        const stage = el('stage'), canvas = el('canvas');
        const scene = new T.Scene();
        const camera = new T.OrthographicCamera(-1,1,1,-1,.1,100);
        const renderer = new T.WebGLRenderer({canvas, alpha:true, antialias:true, preserveDrawingBuffer:true});
        renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.7));
        renderer.setClearColor(0, 0);
        renderer.outputColorSpace = T.SRGBColorSpace;
        scene.add(new T.HemisphereLight(0xffffff, 0xb3beca, 2.1));
        const key = new T.DirectionalLight(0xffffff, 2.45);
        key.position.set(-4,8,4);
        scene.add(key);
        const rim = new T.DirectionalLight(0xffffff, 1.35);
        rim.position.set(4,3,-5);
        scene.add(rim);

        const probe = document.createElement('span');
        probe.hidden = true;
        root.append(probe);
        const css = (token, fallback) => {
          probe.style.color = 'var(' + token + ', ' + fallback + ')';
          const value = getComputedStyle(probe).color;
          if (/^rgba?\(/.test(value)) return new T.Color(value);
          const sample = document.createElement('canvas').getContext('2d', {willReadFrequently:true});
          sample.fillStyle = value;
          sample.fillRect(0,0,1,1);
          const d = sample.getImageData(0,0,1,1).data;
          return new T.Color().setRGB(d[0]/255,d[1]/255,d[2]/255,T.SRGBColorSpace);
        };
        const palette = () => {
          const fg=css('--foreground','#18242d'), bg=css('--background','#ffffff');
          return {fg,bg,muted:css('--muted-foreground','#627483'), water:css('--lab-water','#2983c3'),
            oxygen:css('--lab-oxygen','#068673'), purple:css('--lab-grains','#7947a5'),
            heat:css('--lab-heat','#ec711e'), yellow:css('--yellow','#f8be39'), light:bg.getHSL({}).l>.5};
        };
        let pal = palette();
        const themed = [];
        const color = (mat, fn) => {
          mat.color.copy(fn(pal));
          themed.push(p => mat.color.copy(fn(p)));
          return mat;
        };
        const standard = (fn, props={}) => color(new T.MeshStandardMaterial({roughness:.52,...props}),fn);
        const flat = (fn, props={}) => color(new T.MeshBasicMaterial(props),fn);
        const mix = (a,b,t) => a.clone().lerp(b,t);
        function mesh(geo, mat, x=0,y=0,z=0, parent=scene, order=0) {
          const ob=new T.Mesh(geo,mat);
          ob.position.set(x,y,z);
          ob.renderOrder=order;
          parent.add(ob);
          return ob;
        }
        const box = (w,h,d,mat,x,y,z,parent=scene,order=0) =>
          mesh(new T.BoxGeometry(w,h,d),mat,x,y,z,parent,order);
        const cyl = (rt,rb,h,mat,x,y,z,parent=scene,order=0,n=40) =>
          mesh(new T.CylinderGeometry(rt,rb,h,n),mat,x,y,z,parent,order);
        const line = (coords, fn, opacity=1, parent=scene, order=0, loop=false) => {
          const mat=color(new T.LineBasicMaterial({transparent:opacity<1,opacity,depthWrite:opacity===1}),fn);
          const geo=new T.BufferGeometry().setFromPoints(coords);
          const ob=loop ? new T.LineLoop(geo,mat) : new T.Line(geo,mat);
          ob.renderOrder=order; parent.add(ob); return ob;
        };
        const torus = (r,t,mat,x,y,z,parent=scene,order=0) =>
          mesh(new T.TorusGeometry(r,t,10,56),mat,x,y,z,parent,order);
        const lathe = (profile, mat, x,y,z,parent=scene,order=0) =>
          mesh(new T.LatheGeometry(profile.map(([r,h])=>new T.Vector2(r,h)),64),mat,x,y,z,parent,order);
        const chord = (a,b,r,mat,parent=scene,order=0) => {
          const av=V(...a), bv=V(...b), m=av.clone().lerp(bv,.5);
          const c=cyl(r,r,av.distanceTo(bv),mat,m.x,m.y,m.z,parent,order,20);
          c.quaternion.setFromUnitVectors(V(0,1,0),bv.sub(av).normalize());
          return c;
        };
        function glass(fn, strength) {
          const studioWhite=p=>p.light?mix(p.bg,p.water,.035):mix(p.fg,p.water,.08);
          const mat = new T.ShaderMaterial({
            uniforms:{tint:{value:fn(pal)},strength:{value:strength},reflection:{value:studioWhite(pal)}},
            transparent:true, depthWrite:false, side:T.DoubleSide, forceSinglePass:true,
            vertexShader:'varying vec3 n; varying vec3 v; void main(){vec4 p=modelViewMatrix*vec4(position,1.);n=normalize(normalMatrix*normal);v=isOrthographic?vec3(0.,0.,1.):-p.xyz;gl_Position=projectionMatrix*p;}',
            fragmentShader:[
              'uniform vec3 tint; uniform vec3 reflection; uniform float strength;',
              'varying vec3 n; varying vec3 v;',
              'float strip(vec3 ray,vec3 dir,vec3 across,float w,float h){vec3 up=normalize(cross(dir,across));return smoothstep(.4,.7,dot(ray,dir))*',
              '(1.-smoothstep(w*.63,w,abs(dot(ray,across))))*(1.-smoothstep(h*.75,h,abs(dot(ray,up))));}',
              'void main(){vec3 N=normalize(n);vec3 V=normalize(v);float grazing=1.-abs(dot(N,V));',
              'vec3 ray=normalize((vec4(reflect(-V,N),0.)*viewMatrix).xyz);',
              'vec3 key=normalize(vec3(-.56,.62,.55)); vec3 fill=normalize(vec3(.62,.71,-.30));',
              'float spec=.73*strip(ray,key,normalize(cross(vec3(0.,1.,0.),key)),.115,.60)+.34*strip(ray,fill,normalize(cross(vec3(0.,1.,0.),fill)),.22,.41);',
              'float edge=pow(grazing,2.45);float base=strength*(.075+.82*edge);',
              'float highlight=spec*(.35+.63*strength);float a=min(.89,base+highlight);',
              'vec3 c=mix(tint,reflection,highlight/max(a,.001));gl_FragColor=vec4(c,a);',
              '#include <colorspace_fragment>',
              '}'
            ].join('\n')
          });
          themed.push(p=>{mat.uniforms.tint.value.copy(fn(p));mat.uniforms.reflection.value.copy(studioWhite(p));});
          return mat;
        }
        const glassTint=p=>mix(p.water,p.fg,.35);
        const glassEdge=flat(glassTint,{transparent:true,opacity:.55,depthWrite:false});
        const steel=standard(p=>mix(p.muted,p.bg,p.light?.19:.26),{metalness:.24,roughness:.36});
        const steelDark=standard(p=>mix(p.fg,p.muted,.38),{metalness:.13,roughness:.39});
        const steelLight=standard(p=>mix(p.muted,p.bg,.45),{metalness:.17,roughness:.28});
        const rubber=standard(p=>mix(p.fg,p.muted,.22),{roughness:.75});
        const floor = flat(p=>mix(p.bg,p.muted,p.light?.075:.12),{transparent:true,opacity:.72});
        box(10.45,.062,3.95,floor,-.05,-.045,.04);
        const grid = [];
        for(let x=-5;x<=5;x+=.5) grid.push(x,-.009,-1.88,x,-.009,1.96);
        for(let z=-1.75;z<=1.9;z+=.5) grid.push(-5.15,-.009,z,5.06,-.009,z);
        const gridMat=color(new T.LineBasicMaterial({transparent:true,opacity:.2}),p=>p.muted);
        const gridGeo=new T.BufferGeometry();
        gridGeo.setAttribute('position',new T.Float32BufferAttribute(grid,3));
        scene.add(new T.LineSegments(gridGeo,gridMat));
        function shade(x,z,rx,rz){
          const geo=new T.PlaneGeometry(rx*2,rz*2);
          const mat=new T.ShaderMaterial({transparent:true,depthWrite:false,
            uniforms:{tint:{value:pal.fg.clone()},strength:{value:pal.light?.25:.17}},
            vertexShader:'varying vec2 q; void main(){q=uv*2.-1.; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
            fragmentShader:'varying vec2 q; uniform vec3 tint; uniform float strength; void main(){float a=max(0.,1.-dot(q,q));gl_FragColor=vec4(tint,strength*a*a); \n#include <colorspace_fragment>\n}'});
          themed.push(p=>{mat.uniforms.tint.value.copy(p.fg);mat.uniforms.strength.value=p.light?.25:.17;});
          mesh(geo,mat,x,.002,z).rotation.x=-Math.PI/2;
        }

        const glassTube=glass(glassTint,.63);
        const glassRim=flat(p=>mix(p.water,p.fg,.38),{transparent:true,opacity:.72,depthWrite:false});
        const shine=flat(p=>mix(p.bg,p.water,p.light?.16:.5),{transparent:true,opacity:.8,depthWrite:false});
        const apparatus=new Map();
        let workingStart=scene.children.length;
        function finishInstrument(id) {
          const instrument=new T.Group();
          instrument.name=id;
          instrument.add(...scene.children.slice(workingStart));
          scene.add(instrument);
          apparatus.set(id,instrument);
          workingStart=scene.children.length;
          return instrument;
        }
        const standX=-4.10, standZ=-1.03;
        shade(-4,-.65,1.35,1.05);
        box(1.75,.13,1.44,steelDark,standX,.125,standZ);
        box(1.67,.047,1.36,steel,standX,.196,standZ);
        for(const xx of [-.72,.72]) for(const zz of [-.56,.56]) {
          cyl(.092,.103,.05,rubber,standX+xx,.035,standZ+zz);
        }
        cyl(.187,.205,.16,steelDark,standX,.3,standZ);
        cyl(.082,.082,3.25,steel,standX,1.92,standZ);
        cyl(.092,.092,.055,steelLight,standX,3.555,standZ);
        const clampX=-2.75, clampY=2.43, tubeZ=.32;
        box(.37,.33,.32,steelDark,standX,clampY,standZ);
        chord([standX,clampY,standZ],[clampX,clampY,-.09],.061,steelLight);
        chord([standX-.02,clampY,standZ],[standX-.35,clampY,standZ],.062,steelLight);
        box(.072,.217,.192,steel,standX-.355,clampY,standZ);
        const standGroup=finishInstrument('stand');

        const closed=V(-4.27,2.6,tubeZ), mouth=V(-.64,2.25,tubeZ);
        const axis=mouth.clone().sub(closed);
        const length=axis.length();
        const tube=new T.Group();
        tube.position.copy(closed);
        tube.quaternion.setFromUnitVectors(V(0,1,0),axis.normalize());
        scene.add(tube);
        const tubeRadius=.344;
        const glassProfile=[[0,-tubeRadius]];
        for(let j=1;j<=12;j++){
          const k=j/12*Math.PI/2;
          glassProfile.push([tubeRadius*Math.sin(k),-tubeRadius*Math.cos(k)]);
        }
        glassProfile.push([tubeRadius,length],[.326,length+.018],[.296,length+.01]);
        lathe(glassProfile,glassTube,0,0,0,tube,7);
        torus(.331,.027,glassRim,0,length,0,tube,8).rotation.x=Math.PI/2;
        torus(.307,.011,shine,0,length-.044,0,tube,8).rotation.x=Math.PI/2;
        for(const [angle, a, b] of [[.51,.18,length-.24],[.66,.38,length-.46],[-.8,.33,length-.26]]){
          const x=Math.cos(angle)*.347,z=Math.sin(angle)*.347;
          line([V(x,a,z),V(x,b,z)],p=>mix(p.bg,p.water,p.light?.39:.56),angle===.66?.44:.72,tube,8);
        }
        const testRing=torus(.357,.051,steelDark,0,1.53,0,tube);
        testRing.rotation.x=Math.PI/2;
        const testRingTrim=torus(.357,.018,steelLight,0,1.59,0,tube);
        testRingTrim.rotation.x=Math.PI/2;
        const stopY=length+.095;
        const stopper=cyl(.283,.249,.285,rubber,0,stopY,0,tube);
        const stopperLip=cyl(.286,.286,.042,steelDark,0,stopY+.128,0,tube);
        const holeEdge=torus(.083,.018,rubber,0,stopY+.155,0,tube);
        holeEdge.rotation.x=Math.PI/2;
        const cotton=standard(p=>mix(p.bg,p.fg,p.light?.08:.26));
        const woolGeo=new T.IcosahedronGeometry(1,2);
        const cottonTufts=[];
        let seed=137;
        const random=()=>{seed=(1664525*seed+1013904223)>>>0;return seed/4294967296;};
        for(let i=0;i<19;i++){
          const ang=random()*Math.PI*2, r=.20*Math.sqrt(random());
          const tuft=mesh(woolGeo,cotton,r*Math.cos(ang),length-.45+random()*.18,r*Math.sin(ang),tube);
          cottonTufts.push(tuft);
          tuft.scale.set(.054+random()*.063,.045+random()*.058,.061+random()*.046);
        }
        const crystalGeo=new T.DodecahedronGeometry(1,0);
        const crystals=[];
        const grains=Array.from({length:5},(_,i)=>standard(p=>mix(p.purple,p.fg,.29+i*.09),{roughness:.66,flatShading:true}));
        for(let i=0;i<53;i++){
          const along=-.09+.83*Math.pow(random(),1.32);
          const z=(random()-.5)*.41;
          const x=Math.sqrt(Math.max(.019,.258*.258-z*z))-.015-random()*.11;
          const crystal=mesh(crystalGeo,grains[i%grains.length],x,along,z,tube);
          crystals.push(crystal);
          const r=.031+random()*.037;
          crystal.scale.set(r*.88,r*(1+random()*.7),r);
          crystal.rotation.set(random()*7,random()*7,random()*7);
        }

        tube.updateMatrixWorld(true);
        standGroup.attach(testRing);
        standGroup.attach(testRingTrim);
        finishInstrument('tube');
        const lampX=-3.88, lampZ=.31;
        shade(-3.92,.38,1,.9);
        const burner=glass(p=>mix(p.muted,p.fg,.12),.61);
        lathe([[0,.095],[.37,.095],[.48,.16],[.52,.24],[.5,.43],[.42,.57],[.27,.665],[.173,.72],[.171,.829]],burner,lampX,0,lampZ,scene,6);
        const fuel=flat(p=>mix(p.water,p.bg,.55),{transparent:true,opacity:.4,depthWrite:false});
        lathe([[0,.112],[.35,.112],[.441,.172],[.478,.252],[.465,.34],[0,.34]],fuel,lampX,0,lampZ,scene,5);
        torus(.458,.023,glassRim,lampX,.168,lampZ,scene,8).rotation.x=Math.PI/2;
        cyl(.19,.176,.12,steel,lampX,.818,lampZ);
        cyl(.119,.155,.085,steelDark,lampX,.918,lampZ);
        cyl(.044,.057,.125,cotton,lampX,1.007,lampZ);
        const flame = new T.Group();
        flame.position.set(lampX,1.025,lampZ);
        scene.add(flame);
        const flameMat=flat(p=>mix(p.heat,p.yellow,.19),{transparent:true,opacity:.73,depthWrite:false});
        const innerMat=flat(p=>mix(p.yellow,p.bg,.33),{transparent:true,opacity:.86,depthWrite:false});
        const blueMat=flat(p=>mix(p.water,p.purple,.11),{transparent:true,opacity:.7,depthWrite:false});
        lathe([[0,0],[.118,.04],[.178,.23],[.178,.40],[.134,.62],[.078,.82],[.026,1.04],[0,1.13]],flameMat,0,0,0,flame,8);
        lathe([[0,.048],[.084,.11],[.102,.24],[.081,.40],[.044,.54],[0,.79]],innerMat,0,0,0,flame,9);
        lathe([[0,.002],[.091,.03],[.102,.09],[.092,.16],[0,.245]],blueMat,0,0,0,flame,10);
        flame.visible=false;
        finishInstrument('lamp');

        // Rounded bends preserve a connected passage into the mouth of the inverted jar.
        const bent = points => {
          const path=new T.CurvePath();
          let prev=points[0];
          for(let i=1;i<points.length-1;i++){
            const p=points[i], q=points[i+1];
            const radius=Math.min(.22,prev.distanceTo(p)*.4,q.distanceTo(p)*.4);
            const start=p.clone().add(prev.clone().sub(p).normalize().multiplyScalar(radius));
            const end=p.clone().add(q.clone().sub(p).normalize().multiplyScalar(radius));
            path.add(new T.LineCurve3(prev,start));
            path.add(new T.QuadraticBezierCurve3(start,p,end));
            prev=end;
          }
          path.add(new T.LineCurve3(prev,points.at(-1)));
          return path;
        };
        const routePoints = [
          mouth.clone().addScaledVector(axis,-.02),V(.06,2.18,.32),
          V(2.17,.31,.32),V(2.68,.31,.32),V(2.68,.72,.32)
        ];
        const pipeRoute=bent(routePoints);
        const pipeGlass=glass(p=>mix(p.water,p.fg,.42),.64);
        const sleeveStart=.342, sleeveEnd=.457;
        class PipeSection extends T.Curve {
          constructor(from,to){super();this.from=from;this.to=to;}
          getPoint(t,target){const point=pipeRoute.getPoint(this.from+(this.to-this.from)*t);return target?target.copy(point):point;}
        }
        function pipePiece(from,to,radius,material,order) {
          return mesh(new T.TubeGeometry(new PipeSection(from,to),64,radius,16,false),material,0,0,0,scene,order);
        }
        pipePiece(0,sleeveStart,.086,pipeGlass,7);
        const collectorTube=pipePiece(sleeveEnd,1,.086,pipeGlass,7);
        const sleeveMat=standard(p=>mix(p.heat,p.bg,p.light?.33:.17),{roughness:.76});
        pipePiece(sleeveStart,sleeveEnd,.116,sleeveMat,0);
        const sleeveEdge=standard(p=>mix(p.heat,p.fg,.24),{roughness:.63});
        for(const t of [sleeveStart,sleeveEnd]){
          const point=pipeRoute.getPoint(t);
          torus(.101,.014,sleeveEdge,point.x,point.y,point.z).quaternion
            .setFromUnitVectors(V(0,0,1),pipeRoute.getTangent(t));
        }
        const outlet=torus(.077,.014,glassRim,2.68,.72,.32,scene,8);
        outlet.rotation.x=Math.PI/2;
        const alternatePipe=(points)=>{
          const curve=bent([pipeRoute.getPoint(sleeveEnd),...points]);
          const segment=mesh(new T.TubeGeometry(curve,60,.086,16,false),pipeGlass,0,0,0,scene,7);
          const end=points.at(-1);
          const ring=torus(.077,.014,glassRim,end.x,end.y,end.z,scene,8);
          ring.quaternion.setFromUnitVectors(V(0,0,1),curve.getTangent(1));
          segment.visible=ring.visible=false;
          return {segment,ring,curve,end};
        };
        const bathPipe=alternatePipe([V(1.91,.50,.32),V(1.79,.55,.88)]);
        const dryPipe=alternatePipe([V(1.99,1.12,-.02),V(2.91,1.05,-.34)]);
        const pipeGroup=finishInstrument('pipe');
        for(const piece of [stopper,stopperLip,holeEdge]) pipeGroup.attach(piece);

        const tankX = 2.27, tankZ = .28, jarX = 2.68, jarZ = .32;
        shade(2.6,.33,2.25,1.5);
        const poolLevel = .78;
        function tankOutline(width, length, radius, shape = new T.Shape()) {
          const hw = width / 2, hl = length / 2;
          shape.moveTo(-hw + radius, -hl);
          shape.lineTo(hw - radius, -hl);
          shape.quadraticCurveTo(hw, -hl, hw, -hl + radius);
          shape.lineTo(hw, hl - radius);
          shape.quadraticCurveTo(hw, hl, hw - radius, hl);
          shape.lineTo(-hw + radius, hl);
          shape.quadraticCurveTo(-hw, hl, -hw, hl - radius);
          shape.lineTo(-hw, -hl + radius);
          shape.quadraticCurveTo(-hw, -hl, -hw + radius, -hl);
          shape.closePath();
          return shape;
        }
        function basinBand(y, height, width, length, thickness, material, order) {
          const shape = tankOutline(width, length, .18);
          if (thickness) shape.holes.push(tankOutline(width - 2 * thickness, length - 2 * thickness, .12, new T.Path()));
          const geometry = new T.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false, curveSegments: 8 });
          geometry.rotateX(-Math.PI / 2);
          const band = mesh(geometry, material, tankX, y, tankZ);
          band.renderOrder = order;
          return band;
        }
        const basinGlass = glass(glassTint, .31);
        const jarGlass = glass(glassTint, .56);
        const labEdge = flat(p=>mix(p.water,p.fg,.2), {
          transparent: true, opacity: .57, depthWrite: false
        });
        basinBand(.105, .052, 4.25, 2.85, 0, basinGlass, 1);
        basinBand(.15, .79, 4.25, 2.85, .065, basinGlass, 3);
        basinBand(.9, .04, 4.28, 2.88, .095, labEdge, 4);
        basinBand(.128, .035, 4.24, 2.84, .082, labEdge, 2);
        const waterTint = p=>mix(p.water,p.oxygen,.12);
        const tankWater = flat(waterTint,{ transparent: true, opacity: .14, depthWrite: false, side: T.FrontSide });
        basinBand(.154, .624, 4.1, 2.70, .014, tankWater, 1);
        const tankSurfaceShape = tankOutline(4.1, 2.7, .12);
        const submergedJar = new T.Path();
        submergedJar.absarc(jarX - tankX, tankZ - jarZ, .63, 0, Math.PI * 2, true);
        tankSurfaceShape.holes.push(submergedJar);
        const tankSurfaceGeometry = new T.ShapeGeometry(tankSurfaceShape, 32);
        tankSurfaceGeometry.rotateX(-Math.PI / 2);
        const tankSurface = mesh(tankSurfaceGeometry, flat(waterTint,{ opacity: .25, transparent: true, depthWrite: false, side: T.DoubleSide
        }), tankX, poolLevel, tankZ);
        tankSurface.renderOrder = 2;
        const surfacePatch=mesh(new T.CircleGeometry(.631,48),tankSurface.material,jarX,poolLevel,jarZ,scene,2);
        surfacePatch.rotation.x=-Math.PI/2;
        surfacePatch.visible=false;
        const rest = standard(p=>mix(p.muted,p.water,.13));
        for(const dz of [-.405,.405]){
          box(1.11,.041,.11,rest,jarX,.45,jarZ+dz);
          for(const dx of [-.46,.46]) box(.091,.276,.091,rest,jarX+dx,.298,jarZ+dz);
        }
        finishInstrument('tank');

        const jarBody = lathe([
          [.565, .47], [.59, .50], [.59, .60], [.605, .67], [.635, .78], [.715, .90],
          [.762, 1.02], [.77, 1.14], [.77, 3.19], [.763, 3.255], [.735, 3.32], [.69, 3.364],
          [.62, 3.389], [.50, 3.39], [0, 3.39]
        ], jarGlass, jarX, 0, jarZ);
        jarBody.renderOrder = 3;
        for (const [rad, y, thickness] of [[.576, .494, .022], [.595, .589, .012], [.685, 3.358, .014]]) {
          torus(rad, thickness, labEdge, jarX, y, jarZ,scene,4).rotation.x=Math.PI/2;
        }
        const jarWaterMaterial = new T.MeshBasicMaterial({
          color: waterTint, opacity: .24, transparent: true, depthWrite: false, side: T.FrontSide
        });
        const jarSurfaceMaterial = flat(p=>mix(p.water,p.oxygen,.2),{ opacity: .46, transparent: true,
          depthWrite: false, side: T.DoubleSide
        });
        const waterSections = 32, waterColumns = 56;
        const jarWaterSides = new T.LatheGeometry(
          Array.from({ length: waterSections + 1 }, (_, i) => new T.Vector2(.7, i / waterSections)), waterColumns
        );
        const jarWaterMesh = mesh(jarWaterSides, jarWaterMaterial, jarX, 0, jarZ);
        jarWaterMesh.renderOrder = 1;
        jarWaterMesh.frustumCulled = false;
        const jarSurfaceGeo = new T.CircleGeometry(1, 56);
        jarSurfaceGeo.rotateX(-Math.PI / 2);
        const jarSurface = mesh(jarSurfaceGeo, jarSurfaceMaterial, jarX, 3.23, jarZ);
        jarSurface.renderOrder = 2;
        const meniscus = torus(1, .014, labEdge, jarX, 3.23, jarZ);
        meniscus.renderOrder = 4;
        meniscus.rotation.x=Math.PI/2;
        const jarWaterPositions = jarWaterSides.attributes.position;
        jarWaterPositions.setUsage(T.DynamicDrawUsage);
        const jarInside = [[.49, .534], [.6, .549], [.67, .565], [.78, .591], [.90, .667], [1.02, .718], [1.14, .728], [3.23, .728]];
        function jarWaterRadius(y) {
          for (let i = 1; i < jarInside.length; i++) {
            const [nextY, nextR] = jarInside[i];
            if (y <= nextY) {
              const [lastY, lastR] = jarInside[i - 1];
              return T.MathUtils.lerp(lastR, nextR, (y - lastY) / (nextY - lastY));
            }
          }
          return .728;
        }
        const jarWaterAngles = Array.from({length: waterColumns + 1}, (_, col) => {
          const theta = col / waterColumns * Math.PI * 2;
          return [Math.sin(theta), Math.cos(theta)];
        });
        let lastJarLevel;
        function updateJar(progress) {
          const height = T.MathUtils.lerp(3.23, .78, T.MathUtils.clamp(progress, 0, 1));
          if (height === lastJarLevel) return;
          lastJarLevel = height;
          for (let row = 0; row <= waterSections; row++) {
            const y = T.MathUtils.lerp(.49, height, row / waterSections);
            const radius = jarWaterRadius(y);
            for (let col = 0; col <= waterColumns; col++) {
              const [sx, cz] = jarWaterAngles[col];
              jarWaterPositions.setXYZ(col * (waterSections + 1) + row, sx * radius, y, cz * radius);
            }
          }
          jarWaterPositions.needsUpdate = true;
          const radius = jarWaterRadius(height);
          jarSurface.position.y = meniscus.position.y = height;
          jarSurface.scale.set(radius, 1, radius);
          meniscus.scale.set(radius, radius, 1);
        }
        updateJar(0);
        const jarGroup=finishInstrument('jar');
        const lid=mesh(new T.CylinderGeometry(.648,.648,.034,56),glassEdge,jarX,.45,jarZ,jarGroup,9);
        const lidRim=torus(.642,.013,glassRim,jarX,.448,jarZ,jarGroup,10);
        lidRim.rotation.x=Math.PI/2;
        lid.visible=lidRim.visible=false;

        const towel=new T.Group();
        const towelMat=standard(p=>mix(p.water,p.bg,.42),{roughness:.92});
        const towelFold=standard(p=>mix(p.water,p.bg,.64),{roughness:.92});
        box(.96,.16,.85,towelMat,0,0,0,towel);
        for(let i=0;i<5;i++) box(.92-i*.018,.032,.047,towelFold,0,.085,-.32+i*.15,towel);
        towel.position.set(-3.92,2.86,.32);
        towel.rotation.z=-.095;
        towel.visible=false;
        scene.add(towel);
        const wood=standard(p=>mix(p.heat,p.fg,.35),{roughness:.8});
        const ember=flat(p=>mix(p.heat,p.yellow,.22));
        function stick(){
          const group=new T.Group();
          box(.042,1.03,.043,wood,0,.5,0,group);
          mesh(new T.SphereGeometry(.051,12,8),ember,0,0,0,group);
          group.visible=false;
          scene.add(group);
          return group;
        }
        const match=stick(), splint=stick();
        const splintFlame=lathe([[0,0],[.055,.025],[.094,.13],[.065,.28],[0,.52]],flameMat,0,.005,0,splint,10);
        splintFlame.visible=false;
        const tubeBase=tube.quaternion.clone();
        const U=T.MathUtils, twoPi=2*Math.PI;
        const oxy=flat(p=>mix(p.oxygen,p.bg,.17),{transparent:true,opacity:.93,depthWrite:false});
        const bubbleMaterial=glass(p=>mix(p.oxygen,p.water,.35),.95);
        const bubbleRim=flat(p=>mix(p.oxygen,p.bg,.08),{transparent:true,opacity:.62,depthWrite:false});
        const dotGeo=new T.SphereGeometry(1,12,10), ringGeo=new T.TorusGeometry(1,.13,5,20);
        const dots=Array.from({length:13},()=>mesh(dotGeo,oxy,0,0,0,scene,11));
        const bubbles=Array.from({length:10},()=>{
          const ob=new T.Group();
          mesh(dotGeo,bubbleMaterial,0,0,0,ob,10);
          mesh(ringGeo,bubbleRim,0,0,0,ob,11);
          scene.add(ob);
          return ob;
        });
        const gasLabel=document.createElement('span');
        gasLabel.className='lab-pin viz-badge';
        gasLabel.textContent='O₂';
        gasLabel.style.pointerEvents='none';
        gasLabel.hidden=true;
        el('pins').append(gasLabel);

        const parts = [
          ['高锰酸钾',[-4.05,2.39,.32],[-.71,-1.18], '--lab-grains','深紫色的高锰酸钾受热分解，放出氧气。'],
          ['橡胶塞',[-.48,2.22,.32],[-.38,.61], null,'带孔的橡胶塞封住试管口，导管从孔中穿过。'],
          ['玻璃导管',[.34,1.92,.32],[.06,-1.21], null,'两段玻璃导管斜向下连接，导管末端浸在水中并朝上伸入集气瓶。'],
          ['集气瓶',[2.68,3.27,.32],[.42,-.85], '--lab-water','集气瓶的瓶口朝下并浸在水里，氧气积在瓶内上方。'],
          ['酒精灯',[-3.88,.78,.40],[-.20,1.68], '--lab-heat','酒精灯加热试管中装有高锰酸钾的一端。'],
          ['水槽',[4.08,.50,1.48],[.70,1.05], '--lab-water','瓶内的水被氧气排出，经浸没的瓶口流回水槽。'],
          ['铁架台',[-4.1,3.46,-1.03],[.11,-.55], null,'铁架台夹住试管，使管口略低于装药品的一端。'],
          ['棉花',[-.99,2.28,.35],[-.48,-.6], null,'试管口内侧的棉花可阻挡高锰酸钾粉末进入导管。'],
          ['橡胶管',pipeRoute.getPoint((sleeveStart+sleeveEnd)/2).toArray(),[.56,-.85],'--lab-heat','这段橡胶管套住两段玻璃导管的端部，把它们接成一条气路。']
        ].map(([name,xyz,offset,tint,detail],index)=>{
          const btn=document.createElement('button');
          btn.type='button';
          btn.className='btn btn-ghost lab-pin';
          btn.textContent=name;
          btn.setAttribute('aria-pressed','false');
          el('pins').append(btn);
          const svgNS='http://www.w3.org/2000/svg';
          const leader=document.createElementNS(svgNS,'line');
          leader.setAttribute('stroke','currentColor');
          leader.setAttribute('stroke-opacity','.54');
          const point=document.createElementNS(svgNS,'circle');
          point.setAttribute('r','2.5');
          point.setAttribute('fill',tint ? 'var('+tint+')' : 'currentColor');
          el('lines').append(leader,point);
          return {name,xyz:V(...xyz),offset,tint,detail,index,btn,leader,point};
        });
        const placed=new Set();
        let chosen=null, dragged=null, assembled=false;
        const supplies = [
          ['stand','铁架台','pipette',[-4.12,3.31,-1.03],[-22,-14]],
          ['tube','试管','test-tube-diagonal',[-2.82,2.58,.32],[3,-24]],
          ['lamp','酒精灯','flame',[-3.88,.56,.43],[-14,17]],
          ['pipe','带塞导管','route',[.66,1.72,.32],[1,-24]],
          ['tank','水槽','waves',[4.0,.53,1.14],[13,20]],
          ['jar','集气瓶','cylinder',[2.68,2.88,.32],[20,-18]]
        ];
        const targets = el('targets');
        const ghost=new Map();
        const guideMat=flat(p=>mix(p.water,p.bg,.30),{transparent:true,opacity:.11,depthWrite:false});
        const hotGuideMat=flat(p=>mix(p.oxygen,p.bg,.18),{transparent:true,opacity:.29,depthWrite:false});
        const guideLines=color(new T.LineBasicMaterial({transparent:true,opacity:.21,depthWrite:false}),p=>p.water);
        const guideMeshes = {};
        scene.updateMatrixWorld(true);
        for(const [id] of supplies){
          const group=new T.Group();
          const members=[];
          apparatus.get(id).traverse(obj=>{
            if(obj.isMesh && obj.visible) members.push(obj);
          });
          const hints=members.filter(obj=>{
            if(obj.parent===flame||obj.material.isShaderMaterial&&obj.geometry.type==='PlaneGeometry') return false;
            if(['IcosahedronGeometry','DodecahedronGeometry','TorusGeometry'].includes(obj.geometry.type)) return false;
            if(id==='jar') return obj===jarBody;
            if(id==='tank') return obj.geometry.type==='ExtrudeGeometry';
            return true;
          });
          guideMeshes[id]=[];
          hints.forEach(obj=>{
            const shape=new T.Mesh(obj.geometry,guideMat);
            shape.matrix.copy(obj.matrixWorld);
            shape.matrixAutoUpdate=false;
            shape.renderOrder=2;
            group.add(shape);
            guideMeshes[id].push(shape);
            const edges=new T.LineSegments(new T.EdgesGeometry(obj.geometry,30),guideLines);
            edges.matrix.copy(obj.matrixWorld);
            edges.matrixAutoUpdate=false;
            edges.renderOrder=3;
            group.add(edges);
          });
          scene.add(group);
          ghost.set(id,group);
        }
        const slotList=supplies.map(([id,name,icon,xyz,offset],i)=>{
          const item=el('library').querySelector('[data-instrument="'+id+'"]')||document.createElement('button');
          if(!item.parentNode){
            item.type='button';
            item.draggable=true;
            item.dataset.instrument=id;
            item.className='instrument';
            const mark=document.createElement('i');
            mark.dataset.lucide=icon;
            mark.setAttribute('aria-hidden','true');
            const text=document.createElement('span');
            text.textContent=name;
            item.append(mark,text);
            el('library').append(item);
          }
          const targetBtn=document.createElement('button');
          targetBtn.type='button';
          targetBtn.className='lab-target assembly-slot';
          targetBtn.dataset.slot=id;
          targetBtn.setAttribute('aria-label','放置'+name);
          const number=document.createElement('span');
          number.className='lab-target-number slot-index';
          number.textContent=String(i+1).padStart(2,'0');
          number.setAttribute('aria-hidden','true');
          const title=document.createElement('span');
          title.className='lab-target-name slot-name';
          title.textContent=name;
          targetBtn.append(number,title);
          targets.append(targetBtn);
          item.addEventListener('click',()=>choose(chosen===id?null:id));
          item.addEventListener('dragstart',e=>{
            if(placed.has(id)){e.preventDefault();return;}
            dragged=id;
            e.dataTransfer.effectAllowed='move';
            e.dataTransfer.setData('application/x-oxygen-instrument',id);
            e.dataTransfer.setData('text/plain',name);
            root.dataset.dragging=id;
            choose(id);
          });
          item.addEventListener('dragend',()=>{
            dragged=null;
            delete root.dataset.dragging;
            for(const b of targets.children) b.classList.remove('is-over');
          });
          targetBtn.addEventListener('click',()=>place(id,chosen));
          targetBtn.addEventListener('dragover',e=>{
            if(!dragged) return;
            e.preventDefault();
            e.dataTransfer.dropEffect=dragged===id?'move':'none';
            targetBtn.classList.toggle('is-over',dragged===id);
          });
          targetBtn.addEventListener('dragleave',()=>targetBtn.classList.remove('is-over'));
          targetBtn.addEventListener('drop',e=>{
            e.preventDefault();
            targetBtn.classList.remove('is-over');
            if(dragged && e.dataTransfer.getData('application/x-oxygen-instrument')===dragged) place(id,dragged);
          });
          return {id,name,item,btn:targetBtn,xyz:V(...xyz),offset};
        });
        window.lucide?.createIcons();
        function updateAssembly() {
          assembled=placed.size===supplies.length;
          root.dataset.mode=assembled?'demo':'assembly';
          root.dataset.active=chosen||'';
          const a=el('assembly-step'), b=el('demo-step')||el('experiment-step');
          a.toggleAttribute('data-complete',assembled);
          if(assembled) {a.removeAttribute('aria-current');b.setAttribute('aria-current','step');}
          else {b.removeAttribute('aria-current');a.setAttribute('aria-current','step');}
          el('assembly-count').textContent=placed.size+' / '+supplies.length;
          el('reset-assembly').disabled=placed.size===0&&chosen===null;
          el('play').disabled=!assembled;
          if(!assembled) el('play-text').textContent='组装后开始演示';
          for(const {id,btn,item} of slotList){
            const inPlace=placed.has(id);
            item.disabled=inPlace;
            item.draggable=!inPlace;
            item.toggleAttribute('data-placed',inPlace);
            item.setAttribute('aria-pressed',String(id===chosen));
            apparatus.get(id).visible=inPlace;
            ghost.get(id).visible=!inPlace;
            for(const obj of guideMeshes[id]) obj.material=id===chosen?hotGuideMat:guideMat;
            btn.hidden=inPlace;
            btn.classList.toggle('is-target',id===chosen);
          }
          el('pins').hidden=!assembled;
          el('lines').toggleAttribute('hidden',!assembled);
          refreshProcedure();
          request();
        }
        function assemblyNote(message,tone='water'){
          el('note').style.setProperty('--lab-note-color','var(--lab-'+tone+')');
          el('note-text').textContent=message;
        }
        function choose(id){
          if(assembled||placed.has(id)) return;
          chosen=id;
          updateAssembly();
          assemblyNote(id?'已选：'+slotList.find(s=>s.id===id).name+'。':'准备组装');
        }
        function place(id, picked){
          if(assembled||placed.has(id)) return;
          if(!picked){assemblyNote('请先选中仪器库里的仪器。');return;}
          if(picked!==id){assemblyNote('这里放置'+slotList.find(s=>s.id===id).name+'。','heat');return;}
          placed.add(id);
          chosen=null;
          dragged=null;
          delete root.dataset.dragging;
          updateAssembly();
          if(assembled){
            release();
            assemblyNote('仪器已装齐。先检查装置气密性。','oxygen');
            if(document.activeElement===slotList.find(s=>s.id===id).btn) el('play').focus();
          } else {
            assemblyNote(slotList.find(s=>s.id===id).name+'已就位。','oxygen');
            const next=slotList.find(s=>!placed.has(s.id));
            if(document.activeElement===slotList.find(s=>s.id===id).btn) next?.item.focus();
          }
        }
        el('reset-assembly').addEventListener('click',()=>{
          placed.clear(); chosen=null; dragged=null;
          delete root.dataset.dragging;
          time=0; step=0; playing=false; phase=-1; selected=-1;
          for(const p of parts) p.btn.setAttribute('aria-pressed','false');
          resetView();
          release();
          updateAssembly();
          assemblyNote('准备组装');
        });

        let selected=-1, phase=-1, step=0;
        const procedure = [
          ['检查气密性','检查气密性','将导管口浸入水中，用热毛巾微热空试管。导管口冒出气泡，说明装置气密性良好。',2.65],
          ['加药和放棉花','加药和放棉花','向试管底部加入少量高锰酸钾，在试管口内侧放一团棉花。',2.4],
          ['塞紧并调整试管','塞紧并调整试管','塞紧橡胶塞，使试管口略向下倾斜，并将导管口伸入水中。',1.75],
          ['点燃酒精灯','点燃酒精灯','点燃酒精灯，给装有高锰酸钾的试管加热。',1.95],
          ['排水集气','开始排水集气','待气泡连续、均匀冒出后，把导管移到装满水的倒置集气瓶口。集满后，在水下盖好玻璃片，再取出集气瓶。',13.4],
          ['移出导管','移出导管','把导管移出水槽。此时酒精灯仍在燃烧。',1.6],
          ['熄灭酒精灯','熄灭酒精灯','用灯帽盖灭酒精灯。先移出导管，再停止加热，可防止水倒吸进试管。',1.65],
          ['检验氧气','检验氧气','移开玻璃片，将带火星的小木条伸入集气瓶。木条复燃，说明收集到了氧气。',2.9]
        ];
        const proc=el('procedure');
        const procRows=procedure.map(([label],i)=>{
          const li=document.createElement('li');
          const btn=document.createElement('button');
          btn.type='button';
          const number=document.createElement('span');
          number.className='step-number';
          number.textContent=String(i+1).padStart(2,'0');
          const title=document.createElement('span');
          title.className='step-label';
          title.textContent=label;
          btn.append(number,title);
          btn.addEventListener('click',()=>el('play').click());
          li.append(btn);
          proc?.append(li);
          return {li,btn};
        });
        function refreshProcedure() {
          procRows.forEach(({li,btn},i)=>{
            const current=assembled&&step===i;
            li.dataset.stepState=i<step?'complete':current?'current':'pending';
            btn.disabled=!current;
            if(current) li.setAttribute('aria-current','step'); else li.removeAttribute('aria-current');
          });
          const detail=el('step-detail');
          if(detail) detail.textContent=!assembled?'':step===procedure.length?'带火星的小木条复燃，证明收集到的是氧气。':procedure[step][2];
        }
        const feedback=[
          '准备检查气密性。',
          '热毛巾温热试管。导管口冒出气泡，气密性良好。',
          '高锰酸钾和棉花已放入试管。',
          '试管口略向下，导管口已伸入水中。',
          '酒精灯已点燃。',
          '导管口气泡逐渐变得连续、均匀。',
          '氧气进入倒置集气瓶，瓶内水面逐渐下降。',
          '在水下盖好玻璃片，再取出集气瓶。',
          '导管已离开水槽，防止水倒吸。',
          '酒精灯已用灯帽盖灭。',
          '把带火星的木条伸入集气瓶。',
          '带火星的小木条复燃，检验为氧气。'
        ];
        function updateNote() {
          const part=parts[selected];
          el('note-text').textContent = part ? part.detail : feedback[Math.max(0,phase)];
          el('note').style.setProperty('--lab-note-color',part
            ? (part.tint ? 'var('+part.tint+')' : 'var(--muted-foreground)')
            : (phase<=3?'var(--lab-water)':phase===4||phase===9?'var(--lab-heat)':'var(--lab-oxygen)'));
        }
        function selectPart(index) {
          selected=index;
          parts.forEach(p=>p.btn.setAttribute('aria-pressed',String(p.index===selected)));
          updateNote();
        }
        parts.forEach(p=>p.btn.addEventListener('click',()=>selectPart(selected===p.index?-1:p.index)));

        const target=V(-.26,1.69,.07);
        const home={az:.25,tilt:.295,zoom:1};
        let az=home.az,tilt=home.tilt,zoom=home.zoom, width=0,height=0;
        const resetView=()=>{az=home.az;tilt=home.tilt;zoom=1;request();};
        function positionCamera() {
          const radius=19;
          camera.position.set(target.x+radius*Math.sin(az)*Math.cos(tilt),
            target.y+radius*Math.sin(tilt),target.z+radius*Math.cos(az)*Math.cos(tilt));
          camera.lookAt(target);
          const xo=Math.max(5.84,2.94*width/height)/zoom, yo=xo*height/width;
          camera.left=-xo;camera.right=xo;camera.top=yo;camera.bottom=-yo;
          camera.updateProjectionMatrix();
          camera.updateMatrixWorld();
        }
        function coords(v) {
          const p=v.clone().project(camera);
          return [(p.x+1)*width*.5,(1-p.y)*height*.5];
        }
        function anchor(p,x,y,rect){
          const [l,t,w,h]=rect;
          p.leader.setAttribute('x1',x);
          p.leader.setAttribute('y1',y);
          p.leader.setAttribute('x2',U.clamp(x,l+2,l+w-2));
          p.leader.setAttribute('y2',U.clamp(y,t+2,t+h-2));
          p.point.setAttribute('cx',x);
          p.point.setAttribute('cy',y);
        }
        function layoutPins() {
          const occupied=[];
          for(const p of parts){
            const [x,y]=coords(p.xyz);
            const hidden=p.relevant===false||x<3||x>width-3||y<3||y>height-3;
            p.btn.hidden=hidden;
            p.leader.style.display=p.point.style.display=hidden?'none':'';
            if(hidden) continue;
            const w=p.btn.offsetWidth,h=p.btn.offsetHeight;
            const gx=(width<460?27:48), gy=(width<460?27:44);
            const tx=x+p.offset[0]*gx-w/2, ty=y+p.offset[1]*gy-h/2;
            const dxs=[0,-.36*w,.36*w,-.82*w,.82*w,-1.25*w,1.25*w];
            const dys=[0,-.7*h,.7*h,-1.45*h,1.45*h,-2.1*h,2.1*h];
            let best,score=Infinity;
            for(const dx of dxs) for(const dy of dys){
              const l=U.clamp(tx+dx,1,width-w-1), t=U.clamp(ty+dy,1,height-h-1);
              const overlaps=occupied.reduce((n,[a,b,c,d])=>n+Math.max(0,Math.min(a+c+3,l+w+3)-Math.max(a,l))*Math.max(0,Math.min(b+d+3,t+h+3)-Math.max(b,t)),0);
              const cost=overlaps*30+Math.hypot(l-tx,t-ty)+.05*Math.hypot(dx,dy);
              if(cost<score){best=[l,t,w,h];score=cost;}
            }
            occupied.push(best);
            p.btn.style.transform='translate('+best[0]+'px,'+best[1]+'px)';
            anchor(p,x,y,best);
          }
        }
        function layoutTargets(){
          const rects=[];
          for(const {btn,xyz,offset,id} of slotList){
            if(placed.has(id)) continue;
            const [x,y]=coords(xyz);
            const w=btn.offsetWidth,h=btn.offsetHeight;
            const tx=x+offset[0]-w/2, ty=y+offset[1]-h/2;
            let best,score=Infinity;
            for(const dx of [0,-w/2,w/2,-w,w]) for(const dy of [0,-h,h,-h*2,h*2]){
              const l=U.clamp(tx+dx,5,Math.max(5,width-w-5)),t=U.clamp(ty+dy,5,Math.max(5,height-h-5));
              const overlap=rects.reduce((n,[a,b,c,d])=>n+Math.max(0,Math.min(a+c+4,l+w+4)-Math.max(a,l))*Math.max(0,Math.min(b+d+4,t+h+4)-Math.max(b,t)),0);
              const cost=overlap*25+Math.hypot(l-tx,t-ty)+.05*Math.hypot(dx,dy);
              if(cost<score){best=[l,t,w,h];score=cost;}
            }
            rects.push(best);
            btn.style.left=best[0]+'px';
            btn.style.top=best[1]+'px';
            btn.style.transform='none';
          }
        }
        const resize=new ResizeObserver(()=>{
          width=stage.clientWidth;height=stage.clientHeight;
          if(width&&height){renderer.setSize(width,height,false);request();}
        });
        resize.observe(stage);
        document.fonts?.ready.then(request);
        const recolor=()=>{pal=palette();themed.forEach(apply=>apply(pal));request();};
        matchMedia('(prefers-color-scheme: dark)').addEventListener('change',recolor);
        const look=new MutationObserver(recolor);
        [document.documentElement,document.body].forEach(e=>look.observe(e,{attributes:true,attributeFilter:['style','class','data-theme','data-bs-theme']}));
        const changeZoom=f=>{zoom=U.clamp(zoom*f,.72,2.4);request();};
        el('zoom-in').addEventListener('click',()=>changeZoom(1.17));
        el('zoom-out').addEventListener('click',()=>changeZoom(1/1.17));
        el('orbit').addEventListener('click',()=>{az=(az+.35)%twoPi; request();});
        el('home').addEventListener('click',resetView);
        canvas.addEventListener('wheel',e=>{e.preventDefault();changeZoom(Math.exp(-U.clamp(e.deltaY,-150,150)*.002));},{passive:false});
        const fingers=new Map();
        const distance=()=>{const [a,b]=fingers.values();return Math.hypot(a.x-b.x,a.y-b.y);};
        canvas.addEventListener('pointerdown',e=>{
          if(e.button!==0&&e.pointerType==='mouse') return;
          canvas.setPointerCapture(e.pointerId);
          fingers.set(e.pointerId,{x:e.clientX,y:e.clientY});
        });
        canvas.addEventListener('pointermove',e=>{
          if(!fingers.has(e.pointerId)) return;
          const old=fingers.get(e.pointerId), gap=fingers.size===2?distance():0;
          fingers.set(e.pointerId,{x:e.clientX,y:e.clientY});
          if(fingers.size===2&&gap>0) changeZoom(distance()/gap);
          else if(fingers.size===1){
            az=(az-(e.clientX-old.x)*.009)%twoPi;
            tilt=U.clamp(tilt+(e.clientY-old.y)*.007,-.12,1.22);
            request();
          }
        });
        ['pointerup','pointercancel','lostpointercapture'].forEach(evt=>canvas.addEventListener(evt,e=>fingers.delete(e.pointerId)));

        const fillStart=3, fillEnd=10.75, capAt=11.60, liftAt=12.35;
        const seedPoint=V(-4.11,2.49,.32);
        let time=0,playing=false,previous=0,raf=0,currentWater;
        const reduced=matchMedia('(prefers-reduced-motion: reduce)');
        const lampCap=lathe([[.204,0],[.201,.23],[.180,.271],[.052,.294],[0,.294]],steelDark,lampX,.854,lampZ);
        lampCap.visible=false;
        const laterJar=V(3.83,0,-1.34), zAxis=V(0,0,1);
        const originalJarPin=parts[3].xyz.clone();
        const waterParts=[jarWaterMesh,jarSurface,meniscus];
        const scope=(i,t)=>step>i||(step===i&&time>=t);
        const release=()=>{
          el('play-text').textContent=playing?'暂停演示':time>0?'继续演示':step===procedure.length?'重新实验':procedure[step][1];
          el('play-icon').hidden=playing;
          el('pause-icon').hidden=!playing;
        };
        el('play').addEventListener('click',()=>{
          if(!assembled) return;
          if(!playing){
            if(step===procedure.length){step=0;time=0;phase=-1;refreshProcedure();}
            selected=-1;
            parts.forEach(p=>p.btn.setAttribute('aria-pressed','false'));
            updateNote();
            previous=performance.now();
          }
          playing=!playing;
          release();
          request();
        });
        function model() {
          const p=step<4?0:step>4?1:U.clamp((time-fillStart)/(fillEnd-fillStart),0,1);
          if(currentWater!==p){updateJar(p);currentWater=p;}
          const surface=U.lerp(3.23,.78,p);
          const inBath=scope(4,fillStart)&&!scope(4,liftAt);
          const collected=scope(4,liftAt);
          const tucked=assembled&&!inBath;
          if(tucked){
            jarGroup.rotation.z=Math.PI;
            jarGroup.position.set(laterJar.x+jarX,3.47,laterJar.z-jarZ);
            parts[3].xyz.set(laterJar.x,2.90,laterJar.z);
          } else {
            jarGroup.rotation.z=0;
            jarGroup.position.set(0,0,0);
            parts[3].xyz.copy(originalJarPin);
          }
          waterParts.forEach(o=>o.visible=!assembled||inBath);
          surfacePatch.visible=tucked;
          const hasLid=assembled&&scope(4,capAt)&&!scope(7,.72);
          lid.visible=lidRim.visible=hasLid;

          const open=assembled&&(step===1||step===2&&time<.83);
          for(const piece of [stopper,stopperLip,holeEdge]) piece.visible=!open;
          pipeGroup.visible=placed.has('pipe')&&!open;
          const dried=assembled&&scope(5,.75);
          const useBath=assembled&&!inBath&&!dried;
          collectorTube.visible=outlet.visible=!useBath&&!dried;
          bathPipe.segment.visible=bathPipe.ring.visible=useBath;
          dryPipe.segment.visible=dryPipe.ring.visible=dried;
          const tiltOffset=scope(2,1.04)?0:step===2?.073*(1-U.clamp((time-.27)/.77,0,1)):.073;
          tube.quaternion.copy(tubeBase);
          if(open) tube.quaternion.premultiply(new T.Quaternion().setFromAxisAngle(zAxis,tiltOffset));
          for(const ob of crystals) ob.visible=assembled&&scope(1,.65);
          for(const ob of cottonTufts) ob.visible=assembled&&scope(1,1.40);
          parts[0].relevant=crystals[0].visible;parts[7].relevant=cottonTufts[0].visible;
          parts[1].relevant=parts[2].relevant=parts[8].relevant=!open;

          towel.visible=assembled&&step===0&&time>.17;
          towel.position.y=2.90+.30*(1-U.clamp(time/.62,0,1));
          match.visible=assembled&&step===3&&time>.19&&time<1.35;
          match.rotation.z=-1.22;
          match.position.set(lampX+.48*(1-U.clamp(time/.75,0,1)),1.08,lampZ+.01);
          lampCap.visible=assembled&&scope(6,.24);
          lampCap.position.y=.854+.47*(1-(step===6?U.clamp((time-.24)/.60,0,1):1));
          splint.visible=assembled&&scope(7,1.02);
          splintFlame.visible=splint.visible&&scope(7,1.81);
          const down=step>7?1:U.clamp((time-1.02)/.85,0,1);
          splint.position.set(laterJar.x,3.67-1.01*down,laterJar.z);
          splint.rotation.z=.17;
          const active=assembled&&scope(3,.76)&&!scope(6,.84);
          flame.visible=active;
          if(active&&playing&&!reduced.matches) {
            flame.rotation.z=.061*Math.sin(time*13)+.025*Math.sin(time*28);
            flame.scale.set(1+.041*Math.cos(time*18),.985+.043*Math.sin(time*16),1);
          } else {flame.rotation.z=0;flame.scale.set(1,1,1);}
          for(let i=0;i<dots.length;i++){
            const u=(time-1.09)*5.2-i*.56;
            const d=u%7.9;
            const ob=dots[i];
            ob.visible=assembled&&step===4&&u>=0&&time<fillEnd;
            if(ob.visible){
              if(d<2.25) ob.position.copy(seedPoint).lerp(routePoints[0],d/2.25);
              else {
                const t=U.clamp((d-2.25)/5.65,0,1);
                if(useBath&&t>=sleeveEnd) ob.position.copy(bathPipe.curve.getPoint((t-sleeveEnd)/(1-sleeveEnd)));
                else ob.position.copy(pipeRoute.getPoint(t));
                if(t>sleeveStart&&t<sleeveEnd) ob.visible=false;
              }
              ob.scale.setScalar(i%3===0?.07:.049);
            }
          }
          for(let i=0;i<bubbles.length;i++){
            const checking=step===0&&time>.61;
            const emits=step===4&&time>1.15&&time<fillEnd;
            const u=(time-(checking?.61:inBath?fillStart:1.15))*2.24-i*.37;
            const start=inBath?V(jarX,.72,jarZ):bathPipe.end;
            const y=start.y+u%(inBath?2.91:.66);
            const ob=bubbles[i];
            ob.visible=assembled&&(checking||emits)&&u>=0&&y<(inBath?surface-.025:.78);
            if(ob.visible){
              const s=y-start.y;
              ob.position.set(start.x+Math.sin(s*5+i*2.25)*Math.min(.18,s*.14),y,start.z+Math.cos(s*4+i)*Math.min(.16,s*.12));
              ob.scale.setScalar(.044+(i%4)*.018);
              ob.quaternion.copy(camera.quaternion);
            }
          }
          gasLabel.hidden=!assembled||p<.30||scope(7,.72);
          if(!gasLabel.hidden) {
            const [x,y]=coords(collected?V(laterJar.x,1.42,laterJar.z):V(jarX,(3.23+surface)*.5,jarZ));
            gasLabel.hidden=x<14||x>width-14||y<12||y>height-12;
            gasLabel.style.transform='translate('+x+'px,'+y+'px) translate(-50%,-50%)';
          }
          const complete=[0,1,2,3,4,7,8,9,11];
          let next=complete[step];
          if(step===0&&time>.85)next=1;
          if(step===1&&time>1.40)next=2;
          if(step===2&&time>1.04)next=3;
          if(step===3&&time>.76)next=4;
          if(step===4&&time>1.15)next=time<fillStart?5:time<capAt?6:7;
          if(step===5&&time>.75)next=8;
          if(step===6&&time>.84)next=9;
          if(step===7&&time>1.02)next=time<1.81?10:11;
          if(phase!==next){phase=next;if(assembled) updateNote();}
        }
        function frame(at){
          raf=0;
          if(!width||!height) return;
          if(playing){
            time+=Math.max(0,(at-previous)/1000);
            previous=at;
            if(time>=procedure[step][3]){
              playing=false;step++;time=0;release();refreshProcedure();
            }
          }
          positionCamera();
          model();
          renderer.render(scene,camera);
          if(assembled) layoutPins(); else layoutTargets();
          if(playing) request();
        }
        function request(){if(!raf) raf=requestAnimationFrame(frame);}
        phase=0;
        for(const name of ['orbit','zoom-in','zoom-out','home']) el(name).disabled=false;
        updateAssembly();
        el('fallback').hidden=true;
      }
    })();
