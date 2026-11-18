import {TransformNode,MeshBuilder,StandardMaterial,Color3} from '@babylonjs/core';
import {createPartnerNameTexture} from './scene-startup.js';
import {playerColor} from './multiplayer.js';

export function createOpponent(scene,{id,slot,materials,shadows,labelCanvas}){
  const root=new TransformNode('opponent '+id,scene),suit=new StandardMaterial('suit '+id,scene);
  suit.diffuseColor=Color3.FromHexString(playerColor(slot));suit.specularColor=Color3.Black();root.setEnabled(false);
  const {dark,metal,cyan,orange}=materials,parts=[];
  function part(name,x,y,z,w,h,d,material){const mesh=MeshBuilder.CreateBox(name,{width:w,height:h,depth:d},scene);mesh.parent=root;mesh.position.set(x,y,z);mesh.material=material;mesh.isPickable=false;shadows?.addShadowCaster(mesh);parts.push(mesh);return mesh;}
  part('torso',0,1.05,0,.52,.65,.3,suit);
  const left=part('left leg',-.16,.36,0,.22,.72,.24,dark),right=part('right leg',.16,.36,0,.22,.72,.24,dark);
  part('head',0,1.55,0,.4,.35,.38,metal);part('visor',0,1.57,.2,.34,.12,.03,cyan);
  part('left arm',-.36,1.03,.1,.18,.55,.22,suit);part('right arm',.36,1.03,.1,.18,.55,.22,suit);
  part('rifle',.3,1,.42,.12,.13,.65,dark);
  const barrel=part('sniper barrel',.3,1,.86,.055,.055,.45,metal),scope=part('sniper scope',.3,1.14,.35,.1,.1,.3,dark),pump=part('shotgun pump',.3,.96,.58,.19,.15,.25,orange);
  const texture=createPartnerNameTexture(scene,labelCanvas),nameMaterial=new StandardMaterial('name '+id,scene);
  nameMaterial.diffuseTexture=texture;texture.hasAlpha=true;nameMaterial.useAlphaFromDiffuseTexture=true;nameMaterial.emissiveColor=Color3.White();nameMaterial.backFaceCulling=false;
  const label=MeshBuilder.CreatePlane('label '+id,{width:2.8,height:.5},scene);label.material=nameMaterial;label.isPickable=false;label.billboardMode=7;label.setEnabled(false);
  let previousLabel='';
  return {root,label,color:playerColor(slot),lastStepAt:0,
    update(remote,visible,time){
      visible=visible&&remote.health>0&&remote.entered;root.setEnabled(visible);label.setEnabled(visible);if(!visible)return;
      const p=remote.player;root.position.set(p.x,p.y,p.z);root.rotation.y=remote.yaw;root.scaling.y=p.height/1.75;
      const speed=Math.hypot(p.vx,p.vz),swing=p.grounded&&!p.sliding?Math.sin(time*speed*1.5)*.45:0;left.rotation.x=swing;right.rotation.x=-swing;
      barrel.setEnabled(remote.weaponId==='sniper');scope.setEnabled(remote.weaponId==='sniper');pump.setEnabled(remote.weaponId==='shotgun');
      suit.emissiveColor.set(remote.shieldRemaining>0?.45:p.dashTime>0?.1:0,remote.shieldRemaining>0?.35:p.dashTime>0?.5:0,p.dashTime>0?.4:0);
      label.position.set(p.x,p.y+p.height+.4,p.z);
      const text=remote.name+(remote.shieldRemaining>0?' · PROTECTED':remote.paused?' · PAUSED':'');
      if(text!==previousLabel){previousLabel=text;texture.getContext().clearRect(0,0,512,128);texture.drawText(text,null,80,'bold 34px sans-serif',playerColor(slot),'transparent',true,true);}
    },
    dispose(){for(const mesh of parts)shadows?.removeShadowCaster(mesh);root.dispose();label.dispose();suit.dispose();nameMaterial.dispose();texture.dispose();}
  };
}
