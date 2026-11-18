export const ROOM_CAPACITY=4;
export const PLAYER_COLORS=Object.freeze(['#59cfbd','#e9b65b','#b397ed','#e77b91']);
export function playerColor(slot=0){return PLAYER_COLORS[slot%PLAYER_COLORS.length]||PLAYER_COLORS[0];}
