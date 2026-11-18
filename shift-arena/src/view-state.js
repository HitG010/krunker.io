// Pausing freezes local input, not the multiplayer player's authoritative position.
export function viewPolicy(state,online,health=100){
  const dead=online&&health===0;
  return {
    hideArena:online&&(state==='paused'||dead),
    showOpponent:online&&state==='active'&&!dead,
    followSnapshot:online&&(state==='paused'||dead),
    canResume:!dead,
  };
}
export function snapCameraToPlayer(camera,player,yaw,pitch){
  camera.position.set(player.x,player.y+player.height-.13,player.z);
  camera.rotation.set(pitch,yaw,0);
}
