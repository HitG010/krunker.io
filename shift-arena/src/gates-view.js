import {MeshBuilder,StandardMaterial,Color3} from '@babylonjs/core';
import {SHIFT_GATES} from './arena-shift.js';

export function createGateViews(scene,{panelMaterial,trimMaterial,shadows}={}){
  const views=SHIFT_GATES.map(gate=>{
    const panel=MeshBuilder.CreateBox(gate.id+' shutter',{width:gate.w,height:gate.h,depth:gate.d},scene);
    panel.position.set(gate.x,gate.y,gate.z);panel.material=panelMaterial;panel.receiveShadows=true;shadows?.addShadowCaster(panel);
    for(let i=1;i<gate.h;i++){
      const rib=MeshBuilder.CreateBox(gate.id+' shutter rib',{width:gate.w,height:.055,depth:gate.d+.04},scene);
      rib.parent=panel;rib.position.y=i-gate.h/2;rib.material=trimMaterial;rib.isPickable=false;
    }
    const signal=new StandardMaterial(gate.id+' gate signal',scene);signal.specularColor=Color3.Black();signal.alpha=.85;
    const beacon=MeshBuilder.CreateBox(gate.id+' gate beacon',{width:gate.w,height:.12,depth:1.05},scene);
    beacon.position.set(gate.x,gate.y+gate.h/2+.65,gate.z);beacon.material=signal;beacon.isPickable=false;
    const floor=MeshBuilder.CreateBox(gate.id+' clearance marking',{width:gate.w,height:.025,depth:gate.d+1.12},scene);
    floor.position.set(gate.x,.025,gate.z);floor.material=signal;floor.isPickable=false;
    return {gate,panel,signal};
  });
  return {views,update(shift,elapsed=0){
    for(const {gate,panel,signal} of views){
      const closed=shift.closed.includes(gate.id),changing=shift.phase!=='steady'&&(gate.id===shift.closing||gate.id===shift.opening);
      panel.setEnabled(closed);
      const color=Color3.FromHexString(changing?'#ffb74c':closed?'#ff7046':'#70e4c7');
      signal.diffuseColor=color;signal.emissiveColor=color.scale(changing?.5+.4*(.5+.5*Math.sin(elapsed*8)):.4);
    }
  }};
}
