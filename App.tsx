import React, { useEffect, useRef, useState, useMemo, useCallback } from "react";

// ───────────────────────── Types ─────────────────────────
type Vec = { x: number; y: number };
type PinDef = { x: number; y: number; label: string };
type ComponentType =
  | "battery" | "dc-source" | "ac-source" | "ground"
  | "resistor" | "capacitor" | "inductor"
  | "diode" | "led-red" | "led-green" | "led-blue" | "npn" | "pnp" | "mosfet"
  | "switch" | "push-button" | "pot" | "buzzer" | "bulb"
  | "and" | "or" | "not" | "timer555" | "opamp"
  | "junction" | "current-source";

type CompInstance = {
  id: string;
  type: ComponentType;
  x: number; y: number;
  rotation: 0|90|180|270;
  value: string;
  label: string;
  extra?: any;
  model?: Record<string, number>;
  closed?: boolean;
};
type Wire = { id: string; from: { compId: string; pin: number }; to: { compId: string; pin: number }; color?: string };
type Viewport = { x: number; y: number; zoom: number };
type ConsoleEntry = { t: string; msg: string; kind: "info"|"warn"|"error"|"success" };
type BreadboardHole = { id: string; x: number; y: number; kind: "rail" | "tie" };
type BreadboardItem = { id: string; compId: string; col: number; row: number; rot: 0|90; holes: string[] };
type SimType = "dc" | "tran" | "ac";
type ViewMode = "schematic" | "breadboard" | "split";
type DCSimResult = {
  converged: boolean; iterations: number; nodeVoltages: Record<number, number>;
  branchCurrents: Record<string, number>; branchPower: Record<string, number>;
  litLEDs: Record<string, boolean>; errors: string[]; matrixLog: string[];
  pinToNode: Record<string, number>; nodeCount: number;
  vsMap: { compId: string; idx: number; plus: number; minus: number; voltage: number }[];
  groups: { root: string; pins: string[]; nodeId: number }[];
  behavioralPhase?: number; ledVoltage?: number;
};
type TranPoint = { t: number; nodeVoltages: Record<number, number>; branchCurrents: Record<string, number> };
type ACPoint = { freq: number; nodeVoltagesMag: Record<number, number>; nodeVoltagesPhase: Record<number, number> };

// ───────────────────────── Constants ─────────────────────────
const GRID = 20;
const PIN_DEFS: Record<ComponentType, PinDef[]> = {
  "battery": [{x:-40,y:0,label:"+"},{x:40,y:0,label:"-"}],
  "dc-source": [{x:-40,y:0,label:"+"},{x:40,y:0,label:"-"}],
  "ac-source": [{x:-40,y:0,label:"~"},{x:40,y:0,label:"~"}],
  "ground": [{x:0,y:-30,label:"GND"}],
  "resistor": [{x:-40,y:0,label:"A"},{x:40,y:0,label:"B"}],
  "capacitor": [{x:-40,y:0,label:"A"},{x:40,y:0,label:"B"}],
  "inductor": [{x:-40,y:0,label:"A"},{x:40,y:0,label:"B"}],
  "diode": [{x:-40,y:0,label:"A"},{x:40,y:0,label:"K"}],
  "led-red": [{x:-40,y:0,label:"A"},{x:40,y:0,label:"K"}],
  "led-green": [{x:-40,y:0,label:"A"},{x:40,y:0,label:"K"}],
  "led-blue": [{x:-40,y:0,label:"A"},{x:40,y:0,label:"K"}],
  "npn": [{x:-30,y:-25,label:"C"},{x:-30,y:25,label:"E"},{x:30,y:0,label:"B"}],
  "pnp": [{x:-30,y:-25,label:"C"},{x:-30,y:25,label:"E"},{x:30,y:0,label:"B"}],
  "mosfet": [{x:-30,y:-20,label:"D"},{x:-30,y:20,label:"S"},{x:30,y:0,label:"G"}],
  "switch": [{x:-40,y:0,label:"A"},{x:40,y:0,label:"B"}],
  "push-button": [{x:-40,y:0,label:"A"},{x:40,y:0,label:"B"}],
  "pot": [{x:-40,y:0,label:"A"},{x:40,y:0,label:"B"},{x:0,y:-28,label:"W"}],
  "buzzer": [{x:-40,y:0,label:"+"},{x:40,y:0,label:"-"}],
  "bulb": [{x:-40,y:0,label:"A"},{x:40,y:0,label:"B"}],
  "and": [{x:-35,y:-15,label:"A"},{x:-35,y:15,label:"B"},{x:35,y:0,label:"Y"}],
  "or": [{x:-35,y:-15,label:"A"},{x:-35,y:15,label:"B"},{x:35,y:0,label:"Y"}],
  "not": [{x:-35,y:0,label:"A"},{x:35,y:0,label:"Y"}],
  "timer555": [
    {x:-40,y:-30,label:"GND"},{x:-40,y:-10,label:"TRIG"},{x:-40,y:10,label:"OUT"},{x:-40,y:30,label:"RST"},
    {x:40,y:-30,label:"VCC"},{x:40,y:-10,label:"DIS"},{x:40,y:10,label:"THR"},{x:40,y:30,label:"CTRL"}
  ],
  "opamp": [{x:-30,y:-15,label:"-"},{x:-30,y:15,label:"+"},{x:30,y:0,label:"OUT"},{x:0,y:-30,label:"V+"},{x:0,y:30,label:"V-"}],
  "junction": [{x:0,y:0,label:"J"}],
  "current-source": [{x:-40,y:0,label:"A"},{x:40,y:0,label:"B"}],
};
const COMPONENT_META: Record<ComponentType, { cat: string; name: string; value: string; color: string; modelDefaults?: Record<string, number> }> = {
  "battery": { cat:"Power", name:"Battery 9V", value:"9V", color:"#fbbf24" },
  "dc-source": { cat:"Power", name:"DC Source", value:"5V", color:"#fbbf24" },
  "ac-source": { cat:"Power", name:"AC Source", value:"12V~", color:"#fbbf24" },
  "ground": { cat:"Power", name:"Ground", value:"GND", color:"#71717a" },
  "resistor": { cat:"Passive", name:"Resistor", value:"1kΩ", color:"#a1a1aa" },
  "capacitor": { cat:"Passive", name:"Capacitor", value:"100nF", color:"#60a5fa" },
  "inductor": { cat:"Passive", name:"Inductor", value:"10mH", color:"#a78bfa" },
  "diode": { cat:"Semiconductors", name:"Diode", value:"1N4148", color:"#f87171", modelDefaults:{ Is:1e-14, N:1, Vt:0.02585 } },
  "led-red": { cat:"Semiconductors", name:"LED Red", value:"2V", color:"#ef4444", modelDefaults:{ Is:1e-18, N:1.8, Vt:0.02585, Vf:1.8 } },
  "led-green": { cat:"Semiconductors", name:"LED Green", value:"2.1V", color:"#22c55e", modelDefaults:{ Is:1e-18, N:1.8, Vt:0.02585, Vf:2.1 } },
  "led-blue": { cat:"Semiconductors", name:"LED Blue", value:"3.2V", color:"#3b82f6", modelDefaults:{ Is:1e-18, N:1.8, Vt:0.02585, Vf:3.2 } },
  "npn": { cat:"Semiconductors", name:"NPN Transistor", value:"2N2222", color:"#fbbf24", modelDefaults:{ Beta:100, Is:1e-15, Vt:0.02585 } },
  "pnp": { cat:"Semiconductors", name:"PNP Transistor", value:"2N2907", color:"#fbbf24", modelDefaults:{ Beta:100, Is:1e-15, Vt:0.02585 } },
  "mosfet": { cat:"Semiconductors", name:"MOSFET", value:"IRF540", color:"#a78bfa", modelDefaults:{ K:0.5, Vth:2.0 } },
  "switch": { cat:"Input/Output", name:"Switch", value:"SPST", color:"#fafafa" },
  "push-button": { cat:"Input/Output", name:"Push Button", value:"NO", color:"#fafafa" },
  "pot": { cat:"Input/Output", name:"Potentiometer", value:"68kΩ", color:"#fafafa" },
  "buzzer": { cat:"Input/Output", name:"Buzzer", value:"5V", color:"#fbbf24" },
  "bulb": { cat:"Input/Output", name:"Light Bulb", value:"6V", color:"#fbbf24" },
  "and": { cat:"ICs", name:"AND Gate", value:"74HC08", color:"#8b5cf6" },
  "or": { cat:"ICs", name:"OR Gate", value:"74HC32", color:"#8b5cf6" },
  "not": { cat:"ICs", name:"NOT Gate", value:"74HC04", color:"#8b5cf6" },
  "timer555": { cat:"ICs", name:"555 Timer", value:"NE555", color:"#8b5cf6" },
  "opamp": { cat:"ICs", name:"Op-Amp", value:"LM358", color:"#8b5cf6", modelDefaults:{ Gain:1e5 } },
  "junction": { cat:"Wiring", name:"Junction", value:"", color:"#52525b" },
  "current-source": { cat:"Power", name:"Current Source", value:"1mA", color:"#fbbf24" },
};
const CATEGORIES = ["Power","Passive","Semiconductors","Input/Output","ICs","Wiring"] as const;
function uid(){ return Math.random().toString(36).slice(2,9) }
function rotatePoint(p: Vec, rot: number): Vec { const r = (rot*Math.PI)/180; return { x: p.x*Math.cos(r)-p.y*Math.sin(r), y: p.x*Math.sin(r)+p.y*Math.cos(r) }; }
function getPinWorld(comp: CompInstance, pinIdx: number): Vec { const def = PIN_DEFS[comp.type][pinIdx]; if(!def) return {x:comp.x,y:comp.y}; const rp = rotatePoint(def, comp.rotation); return { x: comp.x + rp.x, y: comp.y + rp.y }; }
function parseResistance(s: string): number {
  const t = s.trim().toLowerCase().replace("Ω","").replace("ohm","").replace(" ","");
  const m = t.match(/^([\d.]+)([kmg]?)(.*)$/); if(!m) return 1000;
  let v = parseFloat(m[1]); const unit = m[2]; if(unit==="k") v*=1e3; if(unit==="m") v*=1e-3; if(unit==="g") v*=1e9;
  if(s.includes("M") && !s.includes("mΩ")) v = parseFloat(m[1])*1e6; return isNaN(v)||v===0?1000:v;
}
function parseCapacitance(s:string): number { const low = s.toLowerCase(); const num = parseFloat(low); if(isNaN(num)) return 100e-9; if(low.includes("pf")) return num*1e-12; if(low.includes("nf")) return num*1e-9; if(low.includes("uf")||low.includes("μf")) return num*1e-6; if(low.includes("mf")) return num*1e-3; return num*1e-9; }
function parseInductance(s:string): number { const low=s.toLowerCase(); const num=parseFloat(low); if(isNaN(num)) return 10e-3; if(low.includes("uh")) return num*1e-6; if(low.includes("mh")) return num*1e-3; if(low.includes("h")) return num*1; return num*1e-3; }
function parseVoltage(s:string): number { const low=s.toLowerCase(); const num=parseFloat(low); if(isNaN(num)) return 5; if(low.includes("mv")) return num*1e-3; if(low.includes("kv")) return num*1e3; return num; }
function parseCurrent(s:string): number { const low=s.toLowerCase(); const num=parseFloat(low); if(isNaN(num)) return 1e-3; if(low.includes("ma")) return num*1e-3; if(low.includes("ua")) return num*1e-6; if(low.includes("na")) return num*1e-9; if(low.includes("a")) return num; return num*1e-3; }

class UnionFind {
  parent: Map<string,string>=new Map(); rank: Map<string,number>=new Map();
  make(x:string){ if(!this.parent.has(x)){ this.parent.set(x,x); this.rank.set(x,0);} }
  find(x:string): string { this.make(x); const p=this.parent.get(x)!; if(p!==x){ const r=this.find(p); this.parent.set(x,r); return r; } return p; }
  union(a:string,b:string){ const ra=this.find(a), rb=this.find(b); if(ra===rb) return; const raR=this.rank.get(ra)!, rbR=this.rank.get(rb)!; if(raR<rbR) this.parent.set(ra,rb); else if(raR>rbR) this.parent.set(rb,ra); else { this.parent.set(rb,ra); this.rank.set(ra,raR+1);} }
}
function gaussianElimination(A: number[][], b: number[]): number[] | null {
  const n = A.length; if(n===0) return []; const M = A.map(row=> [...row]); const B = [...b];
  for(let k=0;k<n;k++){ let maxRow=k; let maxVal=Math.abs(M[k][k]); for(let i=k+1;i<n;i++){ if(Math.abs(M[i][k])>maxVal){ maxVal=Math.abs(M[i][k]); maxRow=i; } } if(maxVal<1e-12){ M[k][k]+=1e-12; maxVal=Math.abs(M[k][k]); if(maxVal<1e-12) return null; } if(maxRow!==k){ [M[k],M[maxRow]]=[M[maxRow],M[k]]; [B[k],B[maxRow]]=[B[maxRow],B[k]]; } const pivot=M[k][k]; for(let i=k+1;i<n;i++){ const factor=M[i][k]/pivot; if(factor===0) continue; for(let j=k;j<n;j++) M[i][j]-=factor*M[k][j]; B[i]-=factor*B[k]; } }
  const x=new Array(n).fill(0); for(let i=n-1;i>=0;i--){ let sum=B[i]; for(let j=i+1;j<n;j++) sum-=M[i][j]*x[j]; if(Math.abs(M[i][i])<1e-12) return null; x[i]=sum/M[i][i]; } return x;
}
function buildNetGroups(components: CompInstance[], wires: Wire[]) {
  const uf=new UnionFind(); const allPins: string[]=[]; components.forEach(c=>{ const defs=PIN_DEFS[c.type]||[]; defs.forEach((_,idx)=>{ const key=`${c.id}:${idx}`; uf.make(key); allPins.push(key); }); }); wires.forEach(w=>{ const a=`${w.from.compId}:${w.from.pin}`; const b=`${w.to.compId}:${w.to.pin}`; uf.make(a); uf.make(b); uf.union(a,b); });
  const groupsMap=new Map<string,string[]>(); allPins.forEach(pin=>{ const root=uf.find(pin); if(!groupsMap.has(root)) groupsMap.set(root,[]); groupsMap.get(root)!.push(pin); });
  let nodeIdCounter=1; let groundRoot:string|null=null; for(const [root,pins] of groupsMap){ if(pins.some(p=>{ const [cid]=p.split(":"); const comp=components.find(c=>c.id===cid); return comp?.type==="ground"; })){ groundRoot=root; break; } }
  const rootToNode=new Map<string,number>(); const pinToNode: Record<string,number>={}; const groups: { root:string; pins:string[]; nodeId:number }[]=[]; for(const [root,pins] of groupsMap){ let nid:number; if(root===groundRoot){ nid=0; } else { nid=nodeIdCounter++; } rootToNode.set(root,nid); pins.forEach(p=> pinToNode[p]=nid); groups.push({root,pins,nodeId:nid}); }
  let finalNodeCount = groups.length; if(!groundRoot && groups.length>0){ const first=groups[0]; first.nodeId=0; for(let i=1;i<groups.length;i++){ groups[i].nodeId=i; } groups.forEach(g=>{ g.pins.forEach(p=> pinToNode[p]=g.nodeId); }); finalNodeCount=groups.length; groundRoot=first.root; } else { finalNodeCount = nodeIdCounter; if(!groundRoot) finalNodeCount=0; }
  return { pinToNode, groups, nodeCount: finalNodeCount, groundRoot, rootToNode };
}
function dcSolve(components: CompInstance[], wires: Wire[], modelOverrides?: Record<string,Record<string,number>>): DCSimResult {
  const { pinToNode, groups, nodeCount } = buildNetGroups(components,wires);
  const errors:string[]=[]; const matrixLog:string[]=[]; if(nodeCount===0){ return { converged:false, iterations:0, nodeVoltages:{}, branchCurrents:{}, branchPower:{}, litLEDs:{}, errors:["No nodes"], matrixLog, pinToNode, nodeCount, vsMap:[], groups }; }
  const vsList: { compId:string; plus:number; minus:number; voltage:number; type:ComponentType; idx:number }[]=[]; components.forEach(c=>{ if(["battery","dc-source","ac-source"].includes(c.type)){ const plusKey=`${c.id}:0`, minusKey=`${c.id}:1`; const plus=pinToNode[plusKey]; const minus=pinToNode[minusKey]; if(plus===undefined || minus===undefined) return; const v=parseVoltage(c.value); const idx=vsList.length; vsList.push({ compId:c.id, plus, minus, voltage:v, type:c.type, idx }); } }); const nNodes = nodeCount; const nVs = vsList.length; const size = (nNodes-1) + nVs; if(size<=0){ return { converged:true, iterations:0, nodeVoltages:{0:0}, branchCurrents:{}, branchPower:{}, litLEDs:{}, errors:[], matrixLog, pinToNode, nodeCount, vsMap:[], groups }; }
  const diodeStates = new Map<string, { Vd:number; Geq:number; Id:number }>(); components.forEach(c=>{ if(["diode","led-red","led-green","led-blue"].includes(c.type) || c.type==="npn" || c.type==="pnp"){ const key=c.id; diodeStates.set(key,{Vd:0.7, Geq:1e-3, Id:0}); } });
  let nodeVoltages: Record<number,number>={0:0}; let vsCurrents: number[] = new Array(nVs).fill(0); let branchCurrents: Record<string,number>={}; let converged=false; let iterations=0; const maxIter=80; const tol=1e-6;
  for(let iter=0; iter<maxIter; iter++){ iterations=iter+1; const G = Array.from({length:size},()=> new Array(size).fill(0)); const I = new Array(size).fill(0); const getIdx = (nodeId:number):number=> nodeId===0? -1 : nodeId-1; const stampResistor = (a:number,b:number,g:number)=>{ if(a!==0){ const ia=getIdx(a); G[ia][ia]+=g; } if(b!==0){ const ib=getIdx(b); G[ib][ib]+=g; } if(a!==0 && b!==0){ const ia=getIdx(a), ib=getIdx(b); G[ia][ib]-=g; G[ib][ia]-=g; } }; const stampCurrentSource = (a:number,b:number,cur:number)=>{ if(a!==0){ I[getIdx(a)]-=cur; } if(b!==0){ I[getIdx(b)]+=cur; } };
    for(const comp of components){
      const model = { ...(COMPONENT_META[comp.type].modelDefaults||{}), ...(comp.model||{}), ...(modelOverrides?.[comp.id]||{}) }; const pins = PIN_DEFS[comp.type]||[]; const nodes = pins.map((_,idx)=> pinToNode[`${comp.id}:${idx}`]);
      switch(comp.type){
        case "resistor": case "bulb": case "buzzer": case "pot": case "switch": case "push-button": { 
          let R=parseResistance(comp.value); 
          if(comp.type==="bulb") R=100; 
          if(comp.type==="buzzer") R=120; 
          if(comp.type==="pot") R=parseResistance(comp.value);
          if(comp.type==="switch" || comp.type==="push-button"){ R = comp.closed===false ? 1e9 : 0.1; } 
          if(R<=0) R=1e-3; 
          const g=1/R; 
          if(comp.type==="pot"){
            // pot as variable resistor: prefer A-W (0-2), fallback A-B (0-1)
            const aNode = nodes[0];
            const wNode = nodes[2];
            const bNode = nodes[1];
            if(aNode!==undefined && wNode!==undefined){
              stampResistor(aNode, wNode, g);
            } else if(aNode!==undefined && bNode!==undefined){
              stampResistor(aNode, bNode, g);
            } else if(wNode!==undefined && bNode!==undefined){
              stampResistor(wNode, bNode, g);
            }
          } else {
            if(nodes[0]!==undefined && nodes[1]!==undefined) stampResistor(nodes[0], nodes[1], g);
          }
          break; 
        }
        case "capacitor": break; case "inductor": { const g=1e3; if(nodes[0]!==undefined && nodes[1]!==undefined) stampResistor(nodes[0], nodes[1], g); break; }
        case "current-source": { const cur=parseCurrent(comp.value); if(nodes[0]!==undefined && nodes[1]!==undefined) stampCurrentSource(nodes[0], nodes[1], cur); break; }
        case "diode": case "led-red": case "led-green": case "led-blue": {
          const a=nodes[0], b=nodes[1]; if(a===undefined||b===undefined) break; const Va = a===0?0:(nodeVoltages[a]??0.7); const Vb = b===0?0:(nodeVoltages[b]??0); let Vd = (Va-Vb); if(iter===0) Vd=diodeStates.get(comp.id)?.Vd ?? 0.7; const Is = model.Is ?? 1e-14; const N = model.N ?? 1; const Vt = model.Vt ?? 0.02585; const VdLimited = Math.min(Math.max(Vd, -5), 1.2); const expTerm = Math.exp(VdLimited/(N*Vt)); const expClamped = Math.min(expTerm, 1e12); const Id = Is*(expClamped -1); const Geq = (Is/(N*Vt))*expClamped; const GeqClamped = Math.min(Math.max(Geq, 1e-12), 1e3); const Ieq = Id - GeqClamped*VdLimited; diodeStates.set(comp.id,{Vd:VdLimited, Geq:GeqClamped, Id}); stampResistor(a,b,GeqClamped); stampCurrentSource(a,b,Ieq); break; }
        case "npn": {
          const cNode=nodes[0], eNode=nodes[1], bNode=nodes[2]; if(cNode===undefined||eNode===undefined||bNode===undefined) break; const Vb = bNode===0?0:(nodeVoltages[bNode]??0.7); const Ve = eNode===0?0:(nodeVoltages[eNode]??0); let Vbe = Vb-Ve; if(iter===0) Vbe=0.7; const Is = model.Is ?? 1e-15; const Vt = model.Vt ?? 0.02585; const Beta = model.Beta ?? 100; const VbeLim = Math.min(Math.max(Vbe, -1), 1.2); const expTerm = Math.exp(VbeLim/Vt); const expC = Math.min(expTerm, 1e12); const Ib = Is*(expC-1); const Geq = (Is/Vt)*expC; const GeqC = Math.min(Math.max(Geq,1e-12), 1e3); const Ieq = Ib - GeqC*VbeLim; stampResistor(bNode,eNode,GeqC); stampCurrentSource(bNode,eNode,Ieq); let Ic = Beta*Ib; if(VbeLim<0.3) Ic=0; stampCurrentSource(cNode,eNode,Ic); diodeStates.set(comp.id+"-be",{Vd:VbeLim, Geq:GeqC, Id:Ib}); branchCurrents[comp.id+"-ic"]=Ic; break; }
        case "pnp": { const cNode=nodes[0], eNode=nodes[1], bNode=nodes[2]; if(cNode===undefined||eNode===undefined||bNode===undefined) break; const Ve = eNode===0?0:(nodeVoltages[eNode]??0); const Vb = bNode===0?0:(nodeVoltages[bNode]??0); let Veb = Ve - Vb; if(iter===0) Veb=0.7; const Is = model.Is ?? 1e-15; const Vt = model.Vt ?? 0.02585; const Beta = model.Beta ?? 100; const VebLim = Math.min(Math.max(Veb,-1),1.2); const expTerm=Math.exp(VebLim/Vt); const expC=Math.min(expTerm,1e12); const Ie = Is*(expC-1); const Geq=(Is/Vt)*expC; const GeqC=Math.min(Math.max(Geq,1e-12),1e3); const Ieq=Ie-GeqC*VebLim; stampResistor(eNode,bNode,GeqC); stampCurrentSource(eNode,bNode,Ieq); let Ic=Beta*Ie; if(VebLim<0.3) Ic=0; stampCurrentSource(eNode,cNode,Ic); branchCurrents[comp.id+"-ic"]=Ic; break; }
        case "mosfet": { const dNode=nodes[0], sNode=nodes[1], gNode=nodes[2]; if(dNode===undefined||sNode===undefined||gNode===undefined) break; const Vg = gNode===0?0:(nodeVoltages[gNode]??0); const Vs = sNode===0?0:(nodeVoltages[sNode]??0); const Vd = dNode===0?0:(nodeVoltages[dNode]??0); const Vgs = Vg-Vs; const Vds = Vd-Vs; const K = model.K ?? 0.5; const Vth = model.Vth ?? 2.0; let Id=0; if(Vgs>Vth){ if(Vds >= (Vgs-Vth)){ Id=K*Math.pow(Vgs-Vth,2); } else { Id=K*(2*(Vgs-Vth)*Vds - Vds*Vds); } } stampCurrentSource(dNode,sNode,Id); branchCurrents[comp.id+"-id"]=Id; break; }
        default: break;
      }
    }
    vsList.forEach(vs=>{ const vsRow = (nNodes-1)+vs.idx; const getIdx = (nodeId:number)=> nodeId===0? -1 : nodeId-1; if(vs.plus!==0){ const ia=getIdx(vs.plus); if(ia>=0){ G[ia][vsRow]+=1; G[vsRow][ia]+=1; } } if(vs.minus!==0){ const ib=getIdx(vs.minus); if(ib>=0){ G[ib][vsRow]-=1; G[vsRow][ib]-=1; } } I[vsRow]=vs.voltage; });
    if(iter===0){ matrixLog.push(`MNA size=${size} nodes=${nNodes-1} vs=${nVs}`); }
    const sol = gaussianElimination(G, I); if(!sol){ errors.push(`Singular matrix at iteration ${iter+1}`); break; }
    const newVoltages: Record<number,number>={0:0}; for(let nid=1; nid<nNodes; nid++){ const idx=getIdx(nid); if(idx>=0 && idx<size) newVoltages[nid]=sol[idx]; } const newVsCurrents = sol.slice(nNodes-1); let maxDelta=0; for(const nidStr in newVoltages){ const nid=parseInt(nidStr); const old=nodeVoltages[nid]??0; const delta=Math.abs(newVoltages[nid]-old); if(delta>maxDelta) maxDelta=delta; }
    nodeVoltages=newVoltages; vsCurrents=newVsCurrents; if(maxDelta<tol){ converged=true; matrixLog.push(`Converged in ${iter+1} iters`); break; }
  }
  branchCurrents={...branchCurrents}; const branchPower: Record<string,number>={}; const litLEDs: Record<string,boolean>={};
  for(const comp of components){
    const pins=PIN_DEFS[comp.type]||[]; const nodes=pins.map((_,idx)=> pinToNode[`${comp.id}:${idx}`]);
    if(comp.type==="resistor"||comp.type==="bulb"||comp.type==="pot"||comp.type==="buzzer"||comp.type==="switch"||comp.type==="push-button"){
      const a = comp.type==="pot" ? (nodes[0]!==undefined && nodes[2]!==undefined ? nodes[0] : nodes[0]) : nodes[0];
      const b = comp.type==="pot" ? (nodes[0]!==undefined && nodes[2]!==undefined ? nodes[2] : nodes[1]) : nodes[1];
      if(a===undefined||b===undefined) continue; const Va=nodeVoltages[a]??0, Vb=nodeVoltages[b]??0; 
      let R=parseResistance(comp.value);
      if(comp.type==="bulb") R=100;
      if(comp.type==="buzzer") R=120;
      if(comp.type==="pot") R=parseResistance(comp.value);
      if(comp.type==="switch") R = comp.closed===false?1e9:0.1;
      const cur=(Va-Vb)/ (R||1000); branchCurrents[comp.id]=cur; branchPower[comp.id]=cur*(Va-Vb);
    } else if(comp.type==="diode"||comp.type.startsWith("led")){
      const a=nodes[0], b=nodes[1]; if(a===undefined||b===undefined) continue; const st=diodeStates.get(comp.id); const cur=st?.Id ?? 0; branchCurrents[comp.id]=cur; const Va=nodeVoltages[a]??0, Vb=nodeVoltages[b]??0; branchPower[comp.id]=cur*(Va-Vb); if(comp.type.startsWith("led")){ litLEDs[comp.id]=cur>0.005; }
    } else if(["battery","dc-source","ac-source"].includes(comp.type)){
      const vs=vsList.find(v=>v.compId===comp.id); if(vs){ const cur=vsCurrents[vs.idx]??0; branchCurrents[comp.id]=cur; branchPower[comp.id]=cur*vs.voltage; }
    } else if(comp.type==="current-source"){ const cur=parseCurrent(comp.value); branchCurrents[comp.id]=cur; const a=nodes[0], b=nodes[1]; const Va=nodeVoltages[a??0]??0, Vb=nodeVoltages[b??0]??0; branchPower[comp.id]=cur*(Va-Vb);
    } else if(comp.type==="npn"||comp.type==="pnp"||comp.type==="mosfet"){ const cur=branchCurrents[comp.id+"-ic"]??0; branchCurrents[comp.id]=cur; branchPower[comp.id]=cur* ( (nodeVoltages[nodes[0]??0]??0) - (nodeVoltages[nodes[1]??0]??0) ); }
  }
  const vsMap = vsList.map(v=>({compId:v.compId, idx:v.idx, plus:v.plus, minus:v.minus, voltage:v.voltage}));
  return { converged, iterations, nodeVoltages, branchCurrents, branchPower, litLEDs, errors, matrixLog, pinToNode, nodeCount, vsMap, groups };
}
function buildSpiceNetlist(components:CompInstance[], wires:Wire[], projectName:string): string {
  const { pinToNode, groups } = buildNetGroups(components,wires); const lines:string[]=[]; lines.push(`* ${projectName}`); lines.push(`* Generated by CircuitForge SPICE`); lines.push(`.op`);
  const nodeName=(id:number)=> id===0?"0":`n${id}`; lines.push(`* Nodes: ${groups.map(g=>`${nodeName(g.nodeId)}=${g.pins.join(",")}`).join(" | ")}`);
  let rCount=0, cCount=0, lCount=0, dCount=0, vCount=0, iCount=0, qCount=0, mCount=0;
  components.forEach(c=>{ const nodes=(PIN_DEFS[c.type]||[]).map((_,idx)=> pinToNode[`${c.id}:${idx}`]); const ns=nodes.map(n=> n===undefined? "0" : nodeName(n));
    switch(c.type){
      case "resistor": rCount++; lines.push(`R${rCount} ${ns[0]} ${ns[1]} ${parseResistance(c.value)} ; ${c.label} ${c.value}`); break;
      case "capacitor": cCount++; lines.push(`C${cCount} ${ns[0]} ${ns[1]} ${parseCapacitance(c.value)} ; ${c.label}`); break;
      case "inductor": lCount++; lines.push(`L${lCount} ${ns[0]} ${ns[1]} ${parseInductance(c.value)} ; ${c.label}`); break;
      case "diode": dCount++; lines.push(`D${dCount} ${ns[0]} ${ns[1]} Dmodel${dCount} ; ${c.label}`); lines.push(`.model Dmodel${dCount} D(Is=${c.model?.Is??1e-14} N=${c.model?.N??1})`); break;
      case "led-red": case "led-green": case "led-blue": dCount++; lines.push(`D${dCount} ${ns[0]} ${ns[1]} LED${dCount} ; ${c.label} ${c.value}`); lines.push(`.model LED${dCount} D(Is=${c.model?.Is??1e-18} N=${c.model?.N??1.8} Vfwd=${c.model?.Vf??2})`); break;
      case "battery": case "dc-source": vCount++; lines.push(`V${vCount} ${ns[0]} ${ns[1]} DC ${parseVoltage(c.value)} ; ${c.label}`); break;
      case "ac-source": vCount++; lines.push(`V${vCount} ${ns[0]} ${ns[1]} AC ${parseVoltage(c.value)} SIN(0 ${parseVoltage(c.value)} 1k) ; ${c.label}`); break;
      case "current-source": iCount++; lines.push(`I${iCount} ${ns[0]} ${ns[1]} DC ${parseCurrent(c.value)} ; ${c.label}`); break;
      case "npn": qCount++; lines.push(`Q${qCount} ${ns[0]} ${ns[2]} ${ns[1]} QNPN${qCount} ; ${c.label}`); lines.push(`.model QNPN${qCount} NPN(Bf=${c.model?.Beta??100})`); break;
      case "pnp": qCount++; lines.push(`Q${qCount} ${ns[0]} ${ns[2]} ${ns[1]} QPNP${qCount} ; ${c.label}`); lines.push(`.model QPNP${qCount} PNP(Bf=${c.model?.Beta??100})`); break;
      case "mosfet": mCount++; lines.push(`M${mCount} ${ns[0]} ${ns[2]} ${ns[1]} 0 NMOS${mCount} ; ${c.label}`); lines.push(`.model NMOS${mCount} NMOS(Kp=${c.model?.K??0.5} Vto=${c.model?.Vth??2})`); break;
      case "pot": rCount++; lines.push(`R${rCount} ${ns[0]} ${ns[2]||ns[1]} ${parseResistance(c.value)} ; ${c.label} POT ${c.value}`); break;
      case "buzzer": rCount++; lines.push(`R${rCount} ${ns[0]} ${ns[1]} ${parseResistance("120")} ; ${c.label} Buzzer`); break;
      default: lines.push(`* ${c.type} ${c.label} ${ns.join(" ")} - not translated`); break;
    }
  });
  lines.push(`.tran 0.1m 100m`); lines.push(`.ac dec 20 1 1Meg`); lines.push(`.end`); return lines.join("\n");
}

// ───────────────────────── SVG Symbols ─────────────────────────
function SymbolSVG({ type, value, isLit, isPowered, compId, isBeeping }: { type: ComponentType; value: string; isLit?: boolean; isPowered?: boolean; compId?: string; isBeeping?: boolean }){
  const accent = isPowered ? "#10b981" : "#e4e4e7";
  const isLED = type.startsWith("led");
  const ledColor = type.includes("red") ? "#ef4444" : type.includes("green") ? "#22c55e" : type.includes("blue") ? "#3b82f6" : "#fbbf24";
  const glowId = `glow-${compId||type}-${isLED?ledColor.replace("#",""):"0"}`;

  if(isLED){
    return (
      <svg width={80} height={36} viewBox="-40 -18 80 36" className="overflow-visible">
        <defs>
          <filter id={glowId} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur in="SourceGraphic" stdDeviation={isLit? "3.5" : "0"} result="blur" />
            <feColorMatrix in="blur" type="matrix" values={`1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 ${isLit?18:0} -4`} result="glow" />
            <feMerge>
              <feMergeNode in="glow" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <radialGradient id={`rad-${glowId}`} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor={ledColor} stopOpacity={isLit?1:0} />
            <stop offset="100%" stopColor={ledColor} stopOpacity={0} />
          </radialGradient>
        </defs>
        <line x1={-40} y1={0} x2={-12} y2={0} stroke={accent} strokeWidth={2}/>
        <polygon points="-12,-10 8,0 -12,10" fill={isLit ? ledColor : "#3f3f46"} fillOpacity={isLit ? 1 : 0.35} stroke={isLit ? ledColor : "#52525b"} strokeWidth={2} filter={isLit ? `url(#${glowId})` : undefined} />
        <line x1={8} y1={-10} x2={8} y2={10} stroke={isLit ? ledColor : "#3f3f46"} strokeWidth={2.5} opacity={isLit ? 1 : 0.4} filter={isLit ? `url(#${glowId})` : undefined} />
        <line x1={8} y1={0} x2={40} y2={0} stroke={accent} strokeWidth={2}/>
        {isLit && (
          <>
            <circle cx={0} cy={0} r={16} fill={`url(#rad-${glowId})`} opacity={0.9} />
            <path d="M0 -14 L4 -18" stroke={ledColor} strokeWidth={1.4} opacity={0.9}/>
            <path d="M6 -14 L10 -18" stroke={ledColor} strokeWidth={1.4} opacity={0.9}/>
          </>
        )}
        {!isLit && (
          <>
            <path d="M0 -14 L4 -18" stroke={ledColor} strokeWidth={1.2} opacity={0.18}/>
            <path d="M6 -14 L10 -18" stroke={ledColor} strokeWidth={1.2} opacity={0.18}/>
          </>
        )}
      </svg>
    );
  }

  switch(type){
    case "resistor":
      return (
        <svg width={80} height={24} viewBox="-40 -12 80 24" className="overflow-visible">
          <path d="M-40 0 L-24 0 L-20 -8 L-12 8 L-4 -8 L4 8 L12 -8 L20 8 L24 0 L40 0" fill="none" stroke={accent} strokeWidth={2} />
          <text x={0} y={20} textAnchor="middle" fontSize={8} fill="#a1a1aa" className="mono">{value}</text>
        </svg>
      );
    case "pot":
      return (
        <svg width={90} height={36} viewBox="-45 -18 90 36" className="overflow-visible">
          <path d="M-40 0 L-24 0 L-20 -8 L-12 8 L-4 -8 L4 8 L12 -8 L20 8 L24 0 L40 0" fill="none" stroke={isPowered?"#fbbf24":accent} strokeWidth={2} />
          <g transform="translate(0,-6)">
            <line x1={-8} y1={14} x2={10} y2={-10} stroke="#fafafa" strokeWidth={1.6} strokeLinecap="round"/>
            <polygon points="10,-10 3,-6 5,-12" fill="#fafafa"/>
          </g>
          <text x={0} y={20} textAnchor="middle" fontSize={7} fill={isPowered?"#fbbf24":"#a1a1aa"} className="mono">{value}</text>
          {isPowered && <circle cx={0} cy={0} r={18} fill="none" stroke="#fbbf24" strokeWidth={0.8} opacity={0.25} strokeDasharray="3 3"/>}
        </svg>
      );
    case "buzzer":
      return (
        <svg width={80} height={40} viewBox="-40 -20 80 40" className="overflow-visible">
          <defs>
            <filter id={`buzz-glow-${compId}`} x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation={isBeeping? "2.5":"0"} result="b"/>
              <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
            </filter>
          </defs>
          <line x1={-40} y1={0} x2={-18} y2={0} stroke={accent} strokeWidth={2}/>
          <rect x={-18} y={-12} width={36} height={24} rx={7} fill={isBeeping?"#1c1a0a":"#1f1f23"} stroke={isBeeping?"#fbbf24":"#3f3f46"} strokeWidth={isBeeping?2:1.2} filter={isBeeping?`url(#buzz-glow-${compId})`:undefined}/>
          <circle cx={0} cy={0} r={isBeeping?8:6} fill={isBeeping?"#fbbf24":"#3f3f46"} opacity={isBeeping?0.95:0.5} className={isBeeping?"animate-[ping_0.35s_ease-out_infinite]":""}>
            {isBeeping && <animate attributeName="r" values="6;8.5;6" dur="0.18s" repeatCount="indefinite"/>}
          </circle>
          <circle cx={0} cy={0} r={3} fill={isBeeping?"#09090b":"#52525b"}/>
          <line x1={18} y1={0} x2={40} y2={0} stroke={accent} strokeWidth={2}/>
          {isBeeping && (
            <g opacity={0.9}>
              <path d="M18 -8 Q24 -8 24 0 Q24 8 18 8" fill="none" stroke="#fbbf24" strokeWidth={1.2} strokeLinecap="round">
                <animate attributeName="opacity" values="0.2;1;0.2" dur="0.22s" repeatCount="indefinite"/>
              </path>
              <path d="M22 -12 Q30 -12 30 0 Q30 12 22 12" fill="none" stroke="#fbbf24" strokeWidth={1} strokeLinecap="round" opacity={0.7}>
                <animate attributeName="opacity" values="0.1;0.8;0.1" dur="0.22s" begin="0.07s" repeatCount="indefinite"/>
              </path>
              <path d="M26 -15 Q36 -15 36 0 Q36 15 26 15" fill="none" stroke="#fbbf24" strokeWidth={0.8} strokeLinecap="round" opacity={0.5}>
                <animate attributeName="opacity" values="0.05;0.6;0.05" dur="0.22s" begin="0.14s" repeatCount="indefinite"/>
              </path>
            </g>
          )}
          <text x={0} y={20} textAnchor="middle" fontSize={6} fill={isBeeping?"#fbbf24":"#52525b"} className="mono">{isBeeping?"♪ BEEP":"BUZZ"}</text>
        </svg>
      );
    case "capacitor":
      return (
        <svg width={80} height={32} viewBox="-40 -16 80 32">
          <line x1={-40} y1={0} x2={-4} y2={0} stroke={accent} strokeWidth={2}/>
          <line x1={-4} y1={-12} x2={-4} y2={12} stroke="#60a5fa" strokeWidth={2.5}/>
          <line x1={4} y1={-12} x2={4} y2={12} stroke="#60a5fa" strokeWidth={2.5}/>
          <line x1={4} y1={0} x2={40} y2={0} stroke={accent} strokeWidth={2}/>
        </svg>
      );
    case "inductor":
      return (
        <svg width={80} height={24} viewBox="-40 -12 80 24">
          <path d="M-40 0 H-20 Q-16 -10 -12 0 Q-8 10 -4 0 Q0 -10 4 0 Q8 10 12 0 Q16 -10 20 0 H40" fill="none" stroke="#a78bfa" strokeWidth={2}/>
        </svg>
      );
    case "battery":
      return (
        <svg width={80} height={36} viewBox="-40 -18 80 36">
          <line x1={-40} y1={0} x2={-12} y2={0} stroke={accent} strokeWidth={2}/>
          <line x1={-10} y1={-12} x2={-10} y2={12} stroke="#fbbf24" strokeWidth={3}/>
          <line x1={10} y1={-6} x2={10} y2={6} stroke="#e4e4e7" strokeWidth={3}/>
          <line x1={12} y1={0} x2={40} y2={0} stroke={accent} strokeWidth={2}/>
          <text x={-10} y={-14} fontSize={8} fill="#fbbf24">+</text>
        </svg>
      );
    case "ground":
      return (
        <svg width={40} height={40} viewBox="-20 -20 40 40">
          <line x1={0} y1={-20} x2={0} y2={0} stroke={accent} strokeWidth={2}/>
          <line x1={-12} y1={0} x2={12} y2={0} stroke="#71717a" strokeWidth={2}/>
          <line x1={-8} y1={5} x2={8} y2={5} stroke="#71717a" strokeWidth={2}/>
          <line x1={-4} y1={10} x2={4} y2={10} stroke="#71717a" strokeWidth={2}/>
        </svg>
      );
    case "diode":
      return (
        <svg width={80} height={30} viewBox="-40 -15 80 30">
          <line x1={-40} y1={0} x2={-12} y2={0} stroke={accent} strokeWidth={2}/>
          <polygon points="-12,-10 8,0 -12,10" fill="none" stroke="#f87171" strokeWidth={2}/>
          <line x1={8} y1={-10} x2={8} y2={10} stroke="#f87171" strokeWidth={2}/>
          <line x1={8} y1={0} x2={40} y2={0} stroke={accent} strokeWidth={2}/>
        </svg>
      );
    case "npn":
      return (
        <svg width={80} height={60} viewBox="-40 -30 80 60">
          <circle cx={0} cy={0} r={18} fill="none" stroke={accent} strokeWidth={1.5}/>
          <line x1={-30} y1={-15} x2={0} y2={-8} stroke={accent} strokeWidth={2}/>
          <line x1={-30} y1={15} x2={0} y2={8} stroke={accent} strokeWidth={2}/>
          <line x1={0} y1={-8} x2={0} y2={8} stroke={accent} strokeWidth={2}/>
          <line x1={0} y1={0} x2={20} y2={0} stroke={accent} strokeWidth={2}/>
          <polygon points="12,-3 20,0 12,3" fill={accent}/>
        </svg>
      );
    case "pnp":
      return (
        <svg width={80} height={60} viewBox="-40 -30 80 60">
          <circle cx={0} cy={0} r={18} fill="none" stroke={accent} strokeWidth={1.5}/>
          <line x1={-30} y1={-15} x2={0} y2={-8} stroke={accent} strokeWidth={2}/>
          <line x1={-30} y1={15} x2={0} y2={8} stroke={accent} strokeWidth={2}/>
          <line x1={0} y1={-8} x2={0} y2={8} stroke={accent} strokeWidth={2}/>
          <line x1={0} y1={0} x2={20} y2={0} stroke={accent} strokeWidth={2}/>
          <polygon points="8,-3 0,0 8,3" fill={accent}/>
        </svg>
      );
    case "timer555":
      return (
        <svg width={90} height={90} viewBox="-45 -45 90 90" className="overflow-visible">
          <defs>
            <filter id={`glow555-${compId}`} x="-30%" y="-30%" width="160%" height="160%">
              <feGaussianBlur stdDeviation={isPowered?3:0} result="blur" />
              <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
            </filter>
          </defs>
          <rect x={-30} y={-35} width={60} height={70} rx={5} fill={isPowered?"#1e1b2e":"#18181b"} stroke={isPowered?"#8b5cf6":"#3f3f46"} strokeWidth={isPowered?2:1.6} filter={isPowered?`url(#glow555-${compId})`:undefined} />
          <text x={0} y={-2} textAnchor="middle" fontSize={11} fill={isPowered?"#a78bfa":"#a1a1aa"} fontWeight={700}>555</text>
          <text x={0} y={10} textAnchor="middle" fontSize={6} fill="#52525b" className="mono">{isPowered?`${value}`:"IDLE"}</text>
        </svg>
      );
    case "bulb":
      return (
        <svg width={60} height={50} viewBox="-30 -25 60 50">
          <circle cx={0} cy={-2} r={14} fill={isLit?"#fbbf24":"none"} stroke={isLit?"#fbbf24":"#71717a"} strokeWidth={2} opacity={isLit?0.9:1}/>
          <path d="M-4 12 Q0 16 4 12" stroke={isLit?"#fbbf24":"#52525b"} fill="none" strokeWidth={1.5}/>
          <line x1={-40} y1={0} x2={-14} y2={0} stroke={accent} strokeWidth={2}/>
          <line x1={14} y1={0} x2={40} y2={0} stroke={accent} strokeWidth={2}/>
        </svg>
      );
    default:
      return (
        <svg width={80} height={30} viewBox="-40 -15 80 30">
          <rect x={-24} y={-10} width={48} height={20} rx={4} fill="#18181b" stroke={accent} strokeWidth={1.5}/>
          <text x={0} y={3} textAnchor="middle" fontSize={7} fill="#a1a1aa" className="mono">{value.slice(0,8)}</text>
        </svg>
      );
  }
}

function orthogonalPath(a: Vec, b: Vec, offset=0): string {
  const midX = (a.x + b.x)/2 + offset; const midY = (a.y + b.y)/2; const dx = Math.abs(a.x - b.x); const dy = Math.abs(a.y - b.y);
  if(dx > dy){ return `M ${a.x} ${a.y} L ${midX} ${a.y} L ${midX} ${b.y} L ${b.x} ${b.y}`; } else { return `M ${a.x} ${a.y} L ${a.x} ${midY} L ${b.x} ${midY} L ${b.x} ${b.y}`; }
}
function straightPath(a: Vec,b: Vec): string { const cx = (a.x+b.x)/2; return `M ${a.x} ${a.y} C ${cx} ${a.y}, ${cx} ${b.y}, ${b.x} ${b.y}`; }

// ───────────────────────── Breadboard ─────────────────────────
function BreadboardView({ components, wires, breadboardItems, setBreadboardItems, simResult, onSelectComp }:{
  components:CompInstance[]; wires:Wire[]; breadboardItems:BreadboardItem[]; setBreadboardItems: (v:BreadboardItem[])=>void; simResult:DCSimResult|null; onSelectComp:(id:string)=>void;
}){
  const [dragging, setDragging] = useState<{id:string, offset:Vec}|null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const cols=30; const holeSpacing=26; const startX=60;
  const rowsDef=[
    {name:"R+", y:28, type:"rail" as const, color:"#ef4444"},
    {name:"B+", y:52, type:"rail" as const, color:"#3b82f6"},
    {name:"a", y:108, type:"tie" as const},
    {name:"b", y:132, type:"tie" as const},
    {name:"c", y:156, type:"tie" as const},
    {name:"d", y:180, type:"tie" as const},
    {name:"e", y:204, type:"tie" as const},
    {name:"f", y:262, type:"tie" as const},
    {name:"g", y:286, type:"tie" as const},
    {name:"h", y:310, type:"tie" as const},
    {name:"i", y:334, type:"tie" as const},
    {name:"j", y:358, type:"tie" as const},
    {name:"B-", y:432, type:"rail" as const, color:"#3b82f6"},
    {name:"R-", y:456, type:"rail" as const, color:"#ef4444"},
  ];
  const holes: BreadboardHole[]=[]; for(let r=0;r<rowsDef.length;r++){ const row=rowsDef[r]; for(let c=0;c<cols;c++){ const x=startX + c*holeSpacing; const y=row.y; holes.push({id:`${row.name}-${c}`, x, y, kind: row.type as any}); } }
  const getHoleById=(id:string)=> holes.find(h=>h.id===id);
  const pinToNode = simResult?.pinToNode || {}; const nodeVoltages = simResult?.nodeVoltages || {};
  const holeVoltage=(holeId:string):number|undefined=>{
    for(const item of breadboardItems){ const idx=item.holes.indexOf(holeId); if(idx>=0){ const compId=item.compId; const pinKey=`${compId}:${idx}`; const node=pinToNode[pinKey]; if(node!==undefined) return nodeVoltages[node]; } } return undefined;
  };
  const handleMouseDown=(e:React.MouseEvent, item:BreadboardItem)=>{ const pt = svgRef.current?.createSVGPoint(); if(!pt) return; pt.x=e.clientX; pt.y=e.clientY; const svgP = pt.matrixTransform(svgRef.current?.getScreenCTM()?.inverse()); setDragging({id:item.id, offset:{x: svgP.x - (startX + item.col*holeSpacing), y: svgP.y - rowsDef[item.row].y }}); };
  const handleMouseMove=(e:React.MouseEvent)=>{ if(!dragging) return; const pt = svgRef.current?.createSVGPoint(); if(!pt) return; pt.x=e.clientX; pt.y=e.clientY; const svgP = pt.matrixTransform(svgRef.current?.getScreenCTM()?.inverse()); const newCol=Math.round((svgP.x - startX)/holeSpacing); const clampedCol=Math.max(0, Math.min(cols-1, newCol)); let closestRow=0; let minDist=1e9; rowsDef.forEach((row, idx)=>{ const d=Math.abs(row.y - svgP.y); if(d<minDist){ minDist=d; closestRow=idx; } }); setBreadboardItems(breadboardItems.map(it=> it.id===dragging.id? {...it, col:clampedCol, row:closestRow}: it)); };
  const handleMouseUp=()=> setDragging(null);
  const jumperWires: { id:string; fromHole:string; toHole:string; color:string; current:number }[]=[]; const wireColors=["#ef4444","#22c55e","#3b82f6","#fbbf24","#a78bfa","#fafafa"];
  wires.forEach((w,i)=>{ const fromItem=breadboardItems.find(b=>b.compId===w.from.compId); const toItem=breadboardItems.find(b=>b.compId===w.to.compId); if(!fromItem || !toItem) return; const fromHole=fromItem.holes[w.from.pin]; const toHole=toItem.holes[w.to.pin]; if(!fromHole || !toHole) return; const current = simResult ? (simResult.branchCurrents[w.from.compId]||0) : 0; jumperWires.push({id:w.id, fromHole, toHole, color: wireColors[i%wireColors.length], current}); });
  return (
    <div className="w-full h-full bg-[#0e0e10] flex flex-col">
      <div className="h-10 border-b border-zinc-800 flex items-center px-3 gap-2 text-[11px]">
        <span className="font-semibold text-zinc-300">Breadboard</span>
        <span className="text-zinc-600">30 cols • 555 astable • Pot 10k-100k • Buzzer</span>
        <button onClick={()=> setBreadboardItems([])} className="ml-auto px-2.5 py-1 rounded-full bg-zinc-900 border border-zinc-800 hover:bg-zinc-800">Clear</button>
      </div>
      <div className="flex-1 overflow-auto p-2">
        <svg ref={svgRef} viewBox="0 0 900 500" className="w-full h-auto min-h-[500px] bg-[#151518] rounded-xl border border-zinc-800" onMouseMove={handleMouseMove} onMouseUp={handleMouseUp} onMouseLeave={handleMouseUp}>
          <rect x={10} y={10} width={880} height={480} rx={12} fill="#1b1b1f" stroke="#27272a" strokeWidth={1.5}/>
          <rect x={30} y={18} width={840} height={46} rx={8} fill="#111113" stroke="#27272a" strokeWidth={0.5}/>
          <rect x={30} y={422} width={840} height={46} rx={8} fill="#111113" stroke="#27272a" strokeWidth={0.5}/>
          <rect x={30} y={90} width={840} height={130} rx={8} fill="#18181b" stroke="#27272a" strokeWidth={0.5}/>
          <rect x={30} y={244} width={840} height={130} rx={8} fill="#18181b" stroke="#27272a" strokeWidth={0.5}/>
          <line x1={40} y1={36} x2={860} y2={36} stroke="#ef4444" strokeWidth={1.5} opacity={0.6}/>
          <line x1={40} y1={60} x2={860} y2={60} stroke="#3b82f6" strokeWidth={1.5} opacity={0.6}/>
          <line x1={40} y1={440} x2={860} y2={440} stroke="#3b82f6" strokeWidth={1.5} opacity={0.6}/>
          <line x1={40} y1={464} x2={860} y2={464} stroke="#ef4444" strokeWidth={1.5} opacity={0.6}/>
          {holes.map(h=>{
            const v=holeVoltage(h.id); let fill="#2a2a2e"; let glow=false;
            if(v!==undefined){ const norm=Math.min(Math.max((v+2)/12,0),1); const r=Math.round(200*norm+40); const g=Math.round(80+40*norm); const b=Math.round(255*(1-norm*0.6)); fill=`rgb(${r},${g},${b})`; glow=Math.abs(v)>0.5;
            } else { if(simResult && (h.id.startsWith("R+")||h.id.startsWith("B+"))){ const hasPower = Object.values(simResult.nodeVoltages).some(v=> v>1); if(hasPower){ fill=h.id.startsWith("R+")?"#ef4444":"#3b82f6"; glow=true; } } }
            return (<g key={h.id}>{glow && <circle cx={h.x} cy={h.y} r={7} fill={fill} opacity={0.18}/>} <circle cx={h.x} cy={h.y} r={3.2} fill={fill} stroke="#3f3f46" strokeWidth={0.6}/></g>);
          })}
          {jumperWires.map(j=>{ const from=getHoleById(j.fromHole), to=getHoleById(j.toHole); if(!from||!to) return null; const mx=(from.x+to.x)/2; const my=Math.min(from.y,to.y)-30 - Math.abs(from.x-to.x)*0.15; const thickness=Math.min(4, 2+Math.abs(j.current)*200); return (<g key={j.id}><path d={`M ${from.x} ${from.y} Q ${mx} ${my} ${to.x} ${to.y}`} fill="none" stroke={j.color} strokeWidth={thickness+3} opacity={0.18} strokeLinecap="round"/><path d={`M ${from.x} ${from.y} Q ${mx} ${my} ${to.x} ${to.y}`} fill="none" stroke={j.color} strokeWidth={thickness} strokeLinecap="round"/></g>); })}
          {breadboardItems.map(item=>{ const comp=components.find(c=>c.id===item.compId); if(!comp) return null; const x=startX+item.col*holeSpacing; const y=rowsDef[item.row]?.y ?? 150; const isLed = comp.type.startsWith("led"); const lit = simResult?.litLEDs[comp.id]; const isBuzzer = comp.type==="buzzer"; const beeping = isBuzzer && lit!==undefined ? (simResult?.ledVoltage||0) > 2 : false; // reuse ledVoltage as beep proxy but we also compute in parent; for breadboard we approximate with lit
            return (<g key={item.id} onMouseDown={e=>handleMouseDown(e,item)} onClick={()=> onSelectComp(item.compId)} className="cursor-grab active:cursor-grabbing">
              <rect x={x-28} y={y-18} width={56} height={36} rx={8} fill={isLed && lit ? "#ef4444" : isBuzzer && beeping ? "#fbbf24" : "#1f1f23"} fillOpacity={isLed ? (lit?0.9:0.25) : 0.95} stroke={lit || beeping ? (isBuzzer?"#fbbf24":"#ef4444") : COMPONENT_META[comp.type]?.color||"#52525b"} strokeWidth={lit||beeping?2:1.2} opacity={0.95}/>
              <text x={x} y={y+4} textAnchor="middle" fontSize={9} fill={isLed && lit ? "#fff" : "#e4e4e7"} className="mono">{comp.label}</text>
              {item.holes.map((hid,i)=>{ const hole=getHoleById(hid); if(!hole) return null; return <line key={i} x1={x} y1={y} x2={hole.x} y2={hole.y} stroke={COMPONENT_META[comp.type]?.color||"#a1a1aa"} strokeWidth={1.2} opacity={0.7}/>; })}
              </g>); })}
          {Array.from({length:cols}).map((_,i)=>(<text key={i} x={startX+i*holeSpacing} y={18} textAnchor="middle" fontSize={8} fill="#52525b" className="mono">{i+1}</text>))}
          {rowsDef.map(r=>(<text key={r.name} x={18} y={r.y+3} textAnchor="middle" fontSize={8} fill={r.color||"#71717a"} className="mono">{r.name}</text>))}
        </svg>
      </div>
    </div>
  );
}

// ───────────────────────── Live Oscilloscope for Blinking LED ─────────────────────────
function LiveOscilloscope({ isRunning, currentTime, ledOn, ledVoltage, timeWindow = 2000, freq, isBeeping }:{
  isRunning: boolean; currentTime: number; ledOn: boolean; ledVoltage: number; timeWindow?: number; freq: number; isBeeping?: boolean;
}){
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const traceRef = useRef<{t:number, v:number, b:number}[]>([]);
  useEffect(()=>{
    if(!isRunning) return;
    traceRef.current.push({t: currentTime, v: ledVoltage, b: isBeeping ? 1 : 0});
    const cutoff = currentTime - timeWindow;
    if(traceRef.current.length>400){
      traceRef.current = traceRef.current.filter(p=> p.t >= cutoff || p.t < 100);
      if(traceRef.current.length>500) traceRef.current = traceRef.current.slice(-400);
    }
  }, [currentTime, ledVoltage, isRunning, timeWindow, isBeeping]);

  useEffect(()=>{
    const canvas = canvasRef.current; if(!canvas) return;
    const ctx = canvas.getContext("2d"); if(!ctx) return;
    const dpr = window.devicePixelRatio||1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr; canvas.height = rect.height * dpr;
    ctx.setTransform(dpr,0,0,dpr,0,0);
    const W = rect.width, H = rect.height;
    ctx.clearRect(0,0,W,H);
    ctx.fillStyle = "#0a0a0b"; ctx.fillRect(0,0,W,H);
    ctx.strokeStyle = "#1e1e22"; ctx.lineWidth = 0.5;
    for(let i=0;i<=10;i++){ const x=(i/10)*W; ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,H); ctx.stroke(); }
    for(let i=0;i<=4;i++){ const y=(i/4)*H; ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(W,y); ctx.stroke(); }
    ctx.fillStyle = "#71717a"; ctx.font = "10px Geist Mono";
    ctx.fillText(`LED V + Buzzer 880Hz • ${freq.toFixed(2)}Hz astable • 2s window`, 10, 16);
    ctx.fillText("0V", 6, H-6);
    ctx.fillText("9V", 6, 12);
    const points = traceRef.current;
    if(points.length<2){
      ctx.fillStyle = "#52525b"; ctx.fillText(isRunning ? "Capturing..." : "Paused - Press Play to blink & beep", 12, H/2);
      return;
    }
    const tEnd = currentTime;
    const tStart = Math.max(0, tEnd - timeWindow);
    const range = timeWindow;
    // Buzzer beep shading
    ctx.fillStyle = "rgba(251,191,36,0.08)";
    for(let i=1;i<points.length;i++){
      if(points[i].b>0.5){
        const x0 = ((points[i-1].t - tStart)/range)*W;
        const x1 = ((points[i].t - tStart)/range)*W;
        if(points[i].t >= tStart) ctx.fillRect(x0, 0, Math.max(1, x1-x0), H);
      }
    }
    ctx.strokeStyle = ledOn ? "#ef4444" : "#3f3f46";
    ctx.lineWidth = 2;
    ctx.shadowColor = ledOn ? "#ef4444" : "transparent";
    ctx.shadowBlur = ledOn ? 8 : 0;
    ctx.beginPath();
    points.forEach((p,i)=>{
      if(p.t < tStart) return;
      const x = ((p.t - tStart)/range)*W;
      const y = H - (p.v/9.5)*H*0.8 - H*0.1;
      if(i===0 || points[i-1].t < tStart) ctx.moveTo(x,y); else ctx.lineTo(x,y);
    });
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = "#27272a"; ctx.setLineDash([4,4]); ctx.beginPath();
    const yMid = H - (2/9.5)*H*0.8 - H*0.1; ctx.moveTo(0,yMid); ctx.lineTo(W,yMid); ctx.stroke(); ctx.setLineDash([]);
    const lx = W - 18;
    const ly = H - (ledVoltage/9.5)*H*0.8 - H*0.1;
    ctx.fillStyle = ledOn ? "#ef4444" : "#3f3f46";
    ctx.beginPath(); ctx.arc(lx, ly, ledOn?5:3, 0, Math.PI*2); ctx.fill();
    if(ledOn){
      ctx.fillStyle = "rgba(239,68,68,0.25)"; ctx.beginPath(); ctx.arc(lx, ly, 10, 0, Math.PI*2); ctx.fill();
    }
    ctx.fillStyle = "#a1a1aa"; ctx.font = "10px Geist Mono";
    ctx.fillText(`${(currentTime/1000).toFixed(2)}s • ${ledOn?"ON":"OFF"} ${isBeeping?"🔔 BEEP":""} • ${ledVoltage.toFixed(1)}V`, W-190, H-8);
  }, [currentTime, ledOn, ledVoltage, isRunning, freq, isBeeping]);

  return (
    <div className="w-full bg-zinc-950 border border-zinc-800 rounded-xl overflow-hidden">
      <div className="h-8 border-b border-zinc-800 flex items-center px-3 gap-2 text-[11px]">
        <span className="font-semibold text-zinc-300 flex items-center gap-1.5"><span className={`w-2 h-2 rounded-full ${isRunning?"bg-emerald-400 animate-pulse":"bg-zinc-600"}`} /> Live Scope</span>
        <span className="text-zinc-500 mono hidden sm:inline">{freq.toFixed(2)}Hz • Pot → buzzer 880Hz</span>
        <span className={`ml-auto px-2 py-0.5 rounded-full text-[10px] border ${ledOn?"bg-red-500/15 border-red-500/30 text-red-300":"bg-zinc-800 border-zinc-700 text-zinc-500"}`}>{ledOn?"LED ON":"LED OFF"}</span>
        {isBeeping && <span className="px-2 py-0.5 rounded-full text-[10px] bg-amber-400/15 border border-amber-400/30 text-amber-200 animate-pulse">🔔 BEEP</span>}
      </div>
      <canvas ref={canvasRef} className="w-full h-[160px] block" style={{width:"100%", height:"160px"}} />
    </div>
  );
}

// ───────────────────────── Blinking LED Default Circuit with Pot + Buzzer ─────────────────────────
const BLINKING_DEFAULT = (() => {
  const comps: CompInstance[] = [
    { id:"bat1", type:"battery", x:100, y:100, rotation:0, value:"9V", label:"BAT 9V", model:{}, closed:true },
    { id:"gnd1", type:"ground", x:100, y:300, rotation:0, value:"GND", label:"GND", model:{} },
    { id:"u1", type:"timer555", x:300, y:200, rotation:0, value:"NE555", label:"U1 555", model:{} },
    { id:"r1", type:"resistor", x:200, y:90, rotation:0, value:"10kΩ", label:"R1 10k", model:{} },
    { id:"pot1", type:"pot", x:200, y:200, rotation:0, value:"68kΩ", label:"R2 POT 68k", model:{} },
    { id:"c1", type:"capacitor", x:300, y:340, rotation:90, value:"10uF", label:"C1 10uF", model:{} },
    { id:"r3", type:"resistor", x:420, y:190, rotation:0, value:"1kΩ", label:"R3 1k", model:{} },
    { id:"q1", type:"npn", x:500, y:200, rotation:0, value:"2N2222", label:"Q1", model:{Beta:120, Is:1e-15} },
    { id:"r4", type:"resistor", x:620, y:90, rotation:90, value:"470Ω", label:"R4 470", model:{} },
    { id:"led1", type:"led-red", x:620, y:210, rotation:90, value:"2V", label:"LED1", model:{Is:1e-18,N:1.8,Vf:1.8} },
    { id:"bz1", type:"buzzer", x:620, y:310, rotation:90, value:"5V", label:"BZ1 Buzzer", model:{} },
    { id:"r5", type:"resistor", x:540, y:310, rotation:0, value:"100Ω", label:"R5 100", model:{} },
  ];
  const wires: Wire[] = [
    { id:"w_vcc_r1", from:{compId:"bat1", pin:0}, to:{compId:"r1", pin:0}, color:"#fbbf24" },
    { id:"w_vcc_r4", from:{compId:"bat1", pin:0}, to:{compId:"r4", pin:0}, color:"#fbbf24" },
    { id:"w_vcc_u_vcc", from:{compId:"bat1", pin:0}, to:{compId:"u1", pin:4}, color:"#fbbf24" },
    { id:"w_vcc_u_rst", from:{compId:"bat1", pin:0}, to:{compId:"u1", pin:3}, color:"#fbbf24" },
    { id:"w_gnd_bat", from:{compId:"bat1", pin:1}, to:{compId:"gnd1", pin:0}, color:"#71717a" },
    // Pot as variable resistor: R1 -> DIS + POT A, POT W -> THR/TRIG/C
    { id:"w_r1_dis", from:{compId:"r1", pin:1}, to:{compId:"u1", pin:5}, color:"#ef4444" },
    { id:"w_r1_potA", from:{compId:"r1", pin:1}, to:{compId:"pot1", pin:0}, color:"#ef4444" },
    { id:"w_potW_thr", from:{compId:"pot1", pin:2}, to:{compId:"u1", pin:6}, color:"#22c55e" },
    { id:"w_potW_trig", from:{compId:"pot1", pin:2}, to:{compId:"u1", pin:1}, color:"#22c55e" },
    { id:"w_potW_c", from:{compId:"pot1", pin:2}, to:{compId:"c1", pin:0}, color:"#22c55e" },
    // Tie pot B to W to make rheostat (short)
    { id:"w_potB_W", from:{compId:"pot1", pin:1}, to:{compId:"pot1", pin:2}, color:"#a1a1aa" },
    { id:"w_c_gnd", from:{compId:"c1", pin:1}, to:{compId:"gnd1", pin:0}, color:"#3b82f6" },
    { id:"w_u_gnd", from:{compId:"u1", pin:0}, to:{compId:"gnd1", pin:0}, color:"#3b82f6" },
    { id:"w_ctrl_gnd", from:{compId:"u1", pin:7}, to:{compId:"gnd1", pin:0}, color:"#52525b" },
    { id:"w_out_r3", from:{compId:"u1", pin:2}, to:{compId:"r3", pin:0}, color:"#a78bfa" },
    { id:"w_r3_qb", from:{compId:"r3", pin:1}, to:{compId:"q1", pin:2}, color:"#a78bfa" },
    { id:"w_qe_gnd", from:{compId:"q1", pin:1}, to:{compId:"gnd1", pin:0}, color:"#71717a" },
    { id:"w_qc_led", from:{compId:"q1", pin:0}, to:{compId:"led1", pin:1}, color:"#ef4444" },
    { id:"w_led_r4", from:{compId:"led1", pin:0}, to:{compId:"r4", pin:1}, color:"#fbbf24" },
    // Buzzer parallel with LED via 100Ω
    { id:"w_qc_r5", from:{compId:"q1", pin:0}, to:{compId:"r5", pin:1}, color:"#fbbf24" },
    { id:"w_r5_bz", from:{compId:"r5", pin:0}, to:{compId:"bz1", pin:1}, color:"#fbbf24" },
    { id:"w_bz_r4", from:{compId:"bz1", pin:0}, to:{compId:"r4", pin:1}, color:"#fbbf24" },
  ];
  const bb: BreadboardItem[] = [
    { id:"bb_bat", compId:"bat1", col:0, row:0, rot:0, holes:["R+-0","B--0"] },
    { id:"bb_gnd", compId:"gnd1", col:1, row:12, rot:0, holes:["B--1"] },
    { id:"bb_u1", compId:"u1", col:5, row:4, rot:0, holes:["c-5","a-5","e-5","f-5","c-6","e-6","f-6","a-6"] },
    { id:"bb_r1", compId:"r1", col:3, row:4, rot:0, holes:["e-3","f-3"] },
    { id:"bb_pot", compId:"pot1", col:4, row:4, rot:0, holes:["e-4","f-4","g-4"] },
    { id:"bb_c1", compId:"c1", col:7, row:4, rot:0, holes:["e-7","B--7"] },
    { id:"bb_r3", compId:"r3", col:9, row:4, rot:0, holes:["e-9","b-11"] },
    { id:"bb_q1", compId:"q1", col:12, row:4, rot:0, holes:["c-12","e-13","b-11"] },
    { id:"bb_r4", compId:"r4", col:16, row:2, rot:0, holes:["R+-16","e-16"] },
    { id:"bb_led", compId:"led1", col:16, row:4, rot:0, holes:["f-16","c-12"] },
    { id:"bb_r5", compId:"r5", col:14, row:5, rot:0, holes:["c-14","e-14"] },
    { id:"bb_bz", compId:"bz1", col:16, row:6, rot:0, holes:["f-16","e-14"] },
  ];
  return { comps, wires, bb };
})();

// ───────────────────────── Main App ─────────────────────────
export default function App(){
  const canvasRef = useRef<HTMLDivElement>(null);
  const [components, setComponents] = useState<CompInstance[]>(BLINKING_DEFAULT.comps);
  const [wires, setWires] = useState<Wire[]>(BLINKING_DEFAULT.wires);
  const [breadboardItems, setBreadboardItems] = useState<BreadboardItem[]>(BLINKING_DEFAULT.bb);
  const [viewport, setViewport] = useState<Viewport>({x:0,y:0,zoom:1});
  const [selectedIds, setSelectedIds] = useState<string[]>(["pot1"]);
  const [dragging, setDragging] = useState<{id:string, off:Vec}|null>(null);
  const [panning, setPanning] = useState<{start:Vec, vp:Viewport}|null>(null);
  const [selRect, setSelRect] = useState<{start:Vec,end:Vec}|null>(null);
  const [wiringFrom, setWiringFrom] = useState<{compId:string,pin:number}|null>(null);
  const [mouseWorld, setMouseWorld] = useState<Vec>({x:0,y:0});
  const [isSim, setIsSim] = useState(false);
  const [bezier, setBezier] = useState(false);
  const [projectName, setProjectName] = useState("Blinking LED • Pot + Buzzer");
  const [logs, setLogs] = useState<ConsoleEntry[]>([
    { t:"12:00:01", msg:"CircuitForge • Blinking LED lab loaded • Pot + Buzzer", kind:"info" },
    { t:"12:00:02", msg:"Default: 555 astable with POT R2 10k-100k → NPN → LED + Buzzer", kind:"success" },
  ]);
  const [showCode, setShowCode] = useState(false);
  const [activeFile, setActiveFile] = useState("lib/spice/mna.ts");
  const [history, setHistory] = useState<{comps:CompInstance[], wires:Wire[]}[]>([]);
  const [future, setFuture] = useState<{comps:CompInstance[], wires:Wire[]}[]>([]);
  const [search, setSearch] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("schematic");
  const [simType, setSimType] = useState<SimType>("dc");
  const [dcResult, setDcResult] = useState<DCSimResult|null>(null);
  const [showSpicePanel, setShowSpicePanel] = useState(true);
  const [netlistEdit, setNetlistEdit] = useState("");
  const [modelOverrides, setModelOverrides] = useState<Record<string,Record<string,number>>>({});

  const [isRunning, setIsRunning] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [isMuted, setIsMuted] = useState(false);

  // Audio refs
  const audioCtxRef = useRef<AudioContext|null>(null);
  const oscRef = useRef<OscillatorNode|null>(null);
  const gainRef = useRef<GainNode|null>(null);

  const ensureAudio = useCallback(()=>{
    if(audioCtxRef.current) return audioCtxRef.current;
    const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
    if(!Ctx) return null;
    const ctx = new Ctx() as AudioContext;
    audioCtxRef.current = ctx;
    return ctx;
  },[]);

  // ── Pot-driven frequency: 1.44 / ((R1+2*R2)*C) ──
  const { freq: blinkFreq, r1Val, r2Val, cVal } = useMemo(()=>{
    const r1Comp = components.find(c=> c.id==="r1") || components.find(c=> c.type==="resistor");
    const potComp = components.find(c=> c.type==="pot") || components.find(c=> c.id==="pot1");
    const cComp = components.find(c=> c.id==="c1") || components.find(c=> c.type==="capacitor");
    const R1 = r1Comp ? parseResistance(r1Comp.value) : 10e3;
    const R2 = potComp ? parseResistance(potComp.value) : 68e3;
    const C = cComp ? parseCapacitance(cComp.value) : 10e-6;
    const denom = (R1 + 2*R2) * C;
    const f = denom>0 ? 1.44/denom : 1.5;
    const clamped = Math.min(10, Math.max(0.1, f));
    return { freq: clamped, r1Val: R1, r2Val: R2, cVal: C };
  }, [components]);

  const periodMs = useMemo(()=> 1000 / blinkFreq, [blinkFreq]);

  // continuous loop
  useEffect(()=>{
    if(!isRunning) return;
    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const dt = now - last;
      last = now;
      setCurrentTime(t => {
        let nt = t + dt * speed;
        if(nt > 8000) nt = nt % 8000;
        return nt;
      });
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return ()=> cancelAnimationFrame(raf);
  }, [isRunning, speed]);

  const phase = useMemo(()=> (currentTime % periodMs) / periodMs, [currentTime, periodMs]);
  const ledOn = useMemo(()=> phase < 0.5, [phase]);
  const ledVoltage = useMemo(()=> ledOn ? 8.6 : 0.15, [ledOn]);
  const isBeeping = useMemo(()=> isRunning && ledOn && !isMuted, [isRunning, ledOn, isMuted]);

  // audio beep management
  useEffect(()=>{
    if(!isRunning || isMuted || !ledOn){
      if(oscRef.current && gainRef.current && audioCtxRef.current){
        try{
          const ctx = audioCtxRef.current;
          const g = gainRef.current;
          g.gain.cancelScheduledValues(ctx.currentTime);
          g.gain.linearRampToValueAtTime(0, ctx.currentTime+0.05);
          const oscToStop = oscRef.current;
          setTimeout(()=>{
            try{ oscToStop.stop(); }catch{}
            try{ oscToStop.disconnect(); }catch{}
            try{ g.disconnect(); }catch{}
            if(oscRef.current===oscToStop){
              oscRef.current = null;
              gainRef.current = null;
            }
          }, 80);
        }catch{}
      }
      return;
    }
    if(ledOn && isRunning && !isMuted){
      const ctx = ensureAudio();
      if(!ctx) return;
      if(ctx.state==="suspended") ctx.resume();
      if(oscRef.current) return;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      gain.gain.setValueAtTime(0, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0.22, ctx.currentTime+0.015);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      oscRef.current = osc;
      gainRef.current = gain;
    }
  },[ledOn, isRunning, isMuted, ensureAudio]);

  // cleanup audio on unmount
  useEffect(()=>()=>{ try{ oscRef.current?.stop(); }catch{} audioCtxRef.current?.close(); },[]);

  const displayedResult = useMemo<DCSimResult|null>(()=>{
    if(!dcResult) return null;
    if(!components.some(c=> c.type==="timer555")) return dcResult;
    const newLit = { ...dcResult.litLEDs };
    const newBranchCurrents = { ...dcResult.branchCurrents };
    const newNodeVoltages = { ...dcResult.nodeVoltages };
    const newPower = { ...dcResult.branchPower };

    const led = components.find(c=> c.type.startsWith("led"));
    const q = components.find(c=> c.type==="npn");
    const timer = components.find(c=> c.type==="timer555");
    const buzzer = components.find(c=> c.type==="buzzer");

    if(led){
      newLit[led.id] = isRunning ? ledOn : newLit[led.id];
      newBranchCurrents[led.id] = isRunning ? (ledOn ? 0.015 : 1e-9) : (newBranchCurrents[led.id]||0);
      newPower[led.id] = ledOn ? 0.03 : 0;
      const pinA = dcResult.pinToNode[`${led.id}:0`];
      const pinK = dcResult.pinToNode[`${led.id}:1`];
      if(pinA!==undefined && pinK!==undefined){
        if(isRunning){
          if(ledOn){
            newNodeVoltages[pinA] = 8.6;
            newNodeVoltages[pinK] = 0.25;
          } else {
            newNodeVoltages[pinA] = 9;
            newNodeVoltages[pinK] = 9;
          }
        }
      }
    }
    if(buzzer){
      newBranchCurrents[buzzer.id] = isRunning ? (ledOn ? 0.012 : 0) : (newBranchCurrents[buzzer.id]||0);
      newPower[buzzer.id] = isRunning && ledOn ? 0.06 : 0;
      const bzPlus = dcResult.pinToNode[`${buzzer.id}:0`];
      const bzMinus = dcResult.pinToNode[`${buzzer.id}:1`];
      if(bzPlus!==undefined && bzMinus!==undefined){
        if(isRunning){
          newNodeVoltages[bzPlus] = ledOn ? 8.6 : 0.2;
          newNodeVoltages[bzMinus] = ledOn ? 0.25 : 0.2;
        }
      }
      newLit[buzzer.id] = isRunning ? ledOn : false;
    }
    if(q){
      const base = dcResult.pinToNode[`${q.id}:2`];
      const coll = dcResult.pinToNode[`${q.id}:0`];
      if(base!==undefined){
        newNodeVoltages[base] = isRunning ? (ledOn ? 0.75 : 0.05) : (newNodeVoltages[base]||0);
      }
      if(coll!==undefined){
        newNodeVoltages[coll] = isRunning ? (ledOn ? 0.25 : 8.8) : (newNodeVoltages[coll]||0);
      }
      newBranchCurrents[q.id] = isRunning ? (ledOn ? 0.027 : 0) : (newBranchCurrents[q.id]||0);
    }
    if(timer){
      const out = dcResult.pinToNode[`${timer.id}:2`];
      if(out!==undefined){
        newNodeVoltages[out] = isRunning ? (ledOn ? 8.2 : 0.2) : (newNodeVoltages[out]||0);
      }
    }

    return {
      ...dcResult,
      litLEDs: newLit,
      branchCurrents: newBranchCurrents,
      branchPower: newPower,
      nodeVoltages: newNodeVoltages,
      behavioralPhase: phase,
      ledVoltage: ledVoltage,
    } as DCSimResult;
  }, [dcResult, isRunning, ledOn, ledVoltage, phase, components]);

  const selectedComp = useMemo(()=> components.find(c=> c.id===selectedIds[0]), [components,selectedIds]);
  const potComp = useMemo(()=> components.find(c=> c.type==="pot"), [components]);

  useEffect(()=>{
    (async()=>{
      try{
        const res = await fetch("actions",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"records.list",args:{collection:"circuit_projects"}})});
        const data = await res.json();
        if(data?.data?.records?.length){
          setLogs(l=>[...l,{t:new Date().toLocaleTimeString(), msg:`Found ${data.data.records.length} saved projects • default Blinking LED + POT + Buzzer active`, kind:"info"}]);
        } else {
          setLogs(l=>[...l,{t:new Date().toLocaleTimeString(), msg:`No saved project → Loaded Blinking LED with POT 10k-100k + Buzzer 880Hz`, kind:"success"}]);
        }
      }catch{
        setLogs(l=>[...l,{t:new Date().toLocaleTimeString(), msg:`Offline • Blinking LED + Pot + Buzzer ready`, kind:"info"}]);
      }
    })();
  },[]);

  useEffect(()=>{ setNetlistEdit(buildSpiceNetlist(components,wires,projectName)); },[components,wires,projectName]);

  const pushHistory = useCallback(()=>{ setHistory(h=> [...h.slice(-19), {comps:components, wires}]); setFuture([]); },[components,wires]);

  const worldFromScreen = (sx:number, sy:number): Vec => {
    const rect = canvasRef.current?.getBoundingClientRect(); if(!rect) return {x:sx,y:sy};
    return { x: (sx - rect.left - viewport.x)/viewport.zoom, y: (sy - rect.top - viewport.y)/viewport.zoom };
  };
  const handleCanvasMouseDown = (e: React.MouseEvent)=>{
    const world = worldFromScreen(e.clientX, e.clientY); setMouseWorld(world);
    if(e.button===1 || (e.button===0 && e.altKey)){ setPanning({ start:{x:e.clientX, y:e.clientY}, vp:viewport }); e.preventDefault(); return; }
    if(e.button===0){ const clickedComp = components.find(c=>{ const dx = Math.abs(c.x - world.x); const dy = Math.abs(c.y - world.y); return dx<50 && dy<35; }); if(!clickedComp){ setSelRect({ start:world, end:world }); if(!e.shiftKey) setSelectedIds([]); setWiringFrom(null); } }
  };
  const handleCanvasMouseMove = (e: React.MouseEvent)=>{
    const world = worldFromScreen(e.clientX, e.clientY); setMouseWorld(world);
    if(panning){ const dx = e.clientX - panning.start.x; const dy = e.clientY - panning.start.y; setViewport({ ...panning.vp, x: panning.vp.x + dx, y: panning.vp.y + dy }); }
    if(dragging){ const comp = components.find(c=>c.id===dragging.id); if(comp){ const nx = Math.round((world.x - dragging.off.x)/GRID)*GRID; const ny = Math.round((world.y - dragging.off.y)/GRID)*GRID; setComponents(cs=> cs.map(c=> c.id===dragging.id? {...c, x:nx, y:ny}: c)); } }
    if(selRect){ setSelRect({...selRect, end:world}); }
  };
  const handleCanvasMouseUp = (e: React.MouseEvent)=>{
    if(selRect){ const minX = Math.min(selRect.start.x, selRect.end.x); const maxX = Math.max(selRect.start.x, selRect.end.x); const minY = Math.min(selRect.start.y, selRect.end.y); const maxY = Math.max(selRect.start.y, selRect.end.y); if(Math.abs(maxX-minX)>5 || Math.abs(maxY-minY)>5){ const inside = components.filter(c=> c.x>=minX && c.x<=maxX && c.y>=minY && c.y<=maxY).map(c=>c.id); setSelectedIds(inside); } } setPanning(null); setDragging(null); setSelRect(null);
  };
  const handleWheel = (e: React.WheelEvent)=>{
    e.preventDefault(); const delta = -e.deltaY*0.001; const newZoom = Math.min(2.5, Math.max(0.25, viewport.zoom + delta)); const worldBefore = worldFromScreen(e.clientX, e.clientY); const vp = { ...viewport, zoom:newZoom }; const rect = canvasRef.current?.getBoundingClientRect(); if(rect){ const worldAfter = { x: (e.clientX - rect.left - vp.x)/newZoom, y: (e.clientY - rect.top - vp.y)/newZoom }; const adjustX = (worldAfter.x - worldBefore.x)*newZoom; const adjustY = (worldAfter.y - worldBefore.y)*newZoom; vp.x += adjustX; vp.y += adjustY; } setViewport(vp);
  };
  const addComponent = (type: ComponentType, pos?: Vec)=>{
    pushHistory(); const id = uid(); const meta = COMPONENT_META[type]; const newComp: CompInstance = { id, type, x: pos? Math.round(pos.x/GRID)*GRID : Math.round((200 - viewport.x/viewport.zoom)/GRID)*GRID, y: pos? Math.round(pos.y/GRID)*GRID : Math.round((200 - viewport.y/viewport.zoom)/GRID)*GRID, rotation:0, value:meta.value, label:`${meta.name.split(" ")[0].toUpperCase()}${components.filter(c=>c.type===type).length+1}`, model:{...(meta.modelDefaults||{})}, closed:true, }; setComponents(c=>[...c,newComp]); setSelectedIds([id]); const bbCol = breadboardItems.length*3 % 30; const holes: string[]=[]; if(type==="resistor"||type==="capacitor"||type==="inductor"||type==="diode"||type.startsWith("led")||type==="buzzer"){ holes[0]=`e-${bbCol}`; holes[1]=`f-${bbCol}`; } else if(type==="battery"||type==="dc-source"){ holes[0]=`R+-${bbCol}`; holes[1]=`B--${bbCol}`; } else if(type==="pot"){ holes[0]=`e-${bbCol}`; holes[1]=`f-${bbCol}`; holes[2]=`g-${bbCol}`; } else { holes[0]=`c-${bbCol}`; if((PIN_DEFS[type]||[]).length>1) holes[1]=`d-${bbCol}`; } setBreadboardItems(b=>[...b,{id:uid(), compId:id, col:bbCol, row:4, rot:0, holes}]); setLogs(l=>[...l,{t:new Date().toLocaleTimeString(), msg:`Added ${meta.name}`, kind:"info"}]);
  };
  const handlePinClick = (compId:string, pin:number, e?: React.MouseEvent)=>{
    e?.stopPropagation(); if(!wiringFrom){ setWiringFrom({compId,pin}); setLogs(l=>[...l,{t:new Date().toLocaleTimeString(), msg:`Start wiring from ${compId}:${pin}`, kind:"info"}]); }else{ if(wiringFrom.compId===compId && wiringFrom.pin===pin){ setWiringFrom(null); return; } const exists = wires.some(w=> (w.from.compId===wiringFrom.compId && w.from.pin===wiringFrom.pin && w.to.compId===compId && w.to.pin===pin) || (w.to.compId===wiringFrom.compId && w.to.pin===wiringFrom.pin && w.from.compId===compId && w.from.pin===pin)); if(!exists){ pushHistory(); const colors=["#fbbf24","#22c55e","#3b82f6","#ef4444","#a78bfa"]; setWires(ws=>[...ws,{id:uid(), from:wiringFrom, to:{compId,pin}, color:colors[Math.floor(Math.random()*colors.length)]}]); setLogs(l=>[...l,{t:new Date().toLocaleTimeString(), msg:`Wire connected`, kind:"success"}]); } setWiringFrom(null); }
  };
  const deleteSelected = ()=>{ if(selectedIds.length===0) return; pushHistory(); setComponents(cs=> cs.filter(c=> !selectedIds.includes(c.id))); setWires(ws=> ws.filter(w=> !selectedIds.includes(w.from.compId) && !selectedIds.includes(w.to.compId))); setBreadboardItems(b=> b.filter(bb=> !selectedIds.includes(bb.compId))); setSelectedIds([]); };
  const handleDrop = (e: React.DragEvent)=>{ e.preventDefault(); const type = e.dataTransfer.getData("application/circuit-component") as ComponentType; if(type){ const world = worldFromScreen(e.clientX, e.clientY); addComponent(type, world); } };
  const handleKeyDown = useCallback((e: KeyboardEvent)=>{
    if(e.key==="Delete" || e.key==="Backspace"){ if((e.target as HTMLElement).tagName!=="INPUT" && (e.target as HTMLElement).tagName!=="TEXTAREA"){ deleteSelected(); } }
    if((e.ctrlKey||e.metaKey) && e.key.toLowerCase()==="z"){ e.preventDefault(); if(e.shiftKey){ if(future.length){ const next = future[future.length-1]; setFuture(f=> f.slice(0,-1)); setHistory(h=> [...h, {comps:components, wires}]); setComponents(next.comps); setWires(next.wires); } }else{ if(history.length){ const prev = history[history.length-1]; setHistory(h=> h.slice(0,-1)); setFuture(f=> [...f, {comps:components, wires}]); setComponents(prev.comps); setWires(prev.wires); } } }
  },[components,wires,history,future,selectedIds]);
  useEffect(()=>{ window.addEventListener("keydown", handleKeyDown as any); return ()=> window.removeEventListener("keydown", handleKeyDown as any); },[handleKeyDown]);

  const runDC = ()=>{
    setIsSim(true); try{ const res=dcSolve(components,wires,modelOverrides); setDcResult(res); setLogs(l=>[...l, {t:new Date().toLocaleTimeString(), msg:`DC ${res.converged?"converged":"failed"} in ${res.iterations} iters • ${blinkFreq.toFixed(2)}Hz pot ${Math.round(r2Val/1000)}k`, kind: res.converged?"success":"error"}]); if(res.errors.length){ res.errors.forEach(err=> setLogs(l=>[...l,{t:new Date().toLocaleTimeString(), msg:err, kind:"warn"}])); } }catch(err:any){ setLogs(l=>[...l,{t:new Date().toLocaleTimeString(), msg:`DC error: ${err.message}`, kind:"error"}]); } setTimeout(()=> setIsSim(false), 700);
  };

  useEffect(()=>{ runDC(); },[]);

  const saveProject = async()=>{
    try{
      const payload = { name:projectName, data:{components,wires, viewport, breadboardItems, modelOverrides}, updatedAt:new Date().toISOString() };
      await fetch("actions",{method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({action:"records.create", args:{collection:"circuit_projects", value:payload}})});
      try{ localStorage.setItem("circuitforge_last", JSON.stringify(payload)); }catch{}
      setLogs(l=>[...l,{t:new Date().toLocaleTimeString(), msg:`Project saved: ${projectName}`, kind:"success"}]);
    }catch(err){ setLogs(l=>[...l,{t:new Date().toLocaleTimeString(), msg:`Save failed`, kind:"error"}]); }
  };
  const exportJSON = ()=>{ const data = JSON.stringify({name:projectName, components,wires, viewport, breadboardItems}, null,2); const blob = new Blob([data], {type:"application/json"}); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href=url; a.download=`${projectName.replace(/\s+/g,"_")}.json`; a.click(); URL.revokeObjectURL(url); };
  const loadBlinking = ()=>{
    pushHistory(); setComponents(BLINKING_DEFAULT.comps); setWires(BLINKING_DEFAULT.wires); setBreadboardItems(BLINKING_DEFAULT.bb); setProjectName("Blinking LED • Pot + Buzzer"); setCurrentTime(0); setLogs(l=>[...l,{t:new Date().toLocaleTimeString(), msg:`Loaded Blinking LED • Pot 10k-100k + Buzzer 880Hz • f=${blinkFreq.toFixed(2)}Hz`, kind:"info"}]); setTimeout(()=> runDC(), 100);
  };

  const handlePotChange = (ohms: number)=>{
    const clamped = Math.min(100000, Math.max(10000, ohms));
    const k = clamped/1000;
    const label = `${k % 1 === 0 ? k.toFixed(0) : k.toFixed(1)}kΩ`;
    setComponents(cs=> cs.map(c=> c.type==="pot" ? {...c, value: label, label: `R2 POT ${label}`} : c));
  };

  const codeFiles: Record<string,string> = {
    "lib/spice/mna.ts": `// MNA + Behavioral 555 astable with POT\n// freq = 1.44 / ((R1+2*R2)*C)  R2=pot 10k-100k live\n// Example: R1=10k, R2=68k, C=10uF => f=1.44/((10k+136k)*10uF)=0.986Hz\n// Pot slider updates R2 instantly, periodMs = 1000/f recalculated each frame\n// Buzzer 880Hz sine with Web Audio, gain envelope on LED ON`,
    "components/circuit/BlinkingLED.tsx": `// Battery 9V -> GND\n// 555 at (300,200) R1=10k VCC, POT 100k (A to DIS+R1, W to THR/TRIG/C, B shorted to W)\n// C=10uF GND, OUT->1k->NPN base, emitter GND, collector->LED cathode + Buzzer via 100Ω\n// LED anode->470Ω->9V, Buzzer+ ->470Ω, Buzzer- ->100Ω->collector\n// Behavioral: square wave freq=1.44/((R1+2*POT)*C)`,
  };

  const filteredComponents = useMemo(()=>{
    const q = search.toLowerCase(); if(!q) return COMPONENT_META; const out: any = {}; Object.entries(COMPONENT_META).forEach(([k,v]:any)=>{ if(v.name.toLowerCase().includes(q) || k.includes(q)) out[k]=v; }); return out;
  },[search]);

  return (
    <div data-safe-area-inset-root className="min-h-screen bg-[var(--bg)] text-zinc-100 flex flex-col overflow-x-clip" style={{boxSizing:'border-box', paddingTop:'var(--safe-area-inset-top)'}}>
      <header data-safe-area-sticky-top className="sticky z-30 backdrop-blur-xl bg-zinc-950/80 border-b border-zinc-800" style={{top:'var(--safe-area-inset-top)'}}>
        <div className="h-[56px] px-3 sm:px-4 flex items-center justify-between gap-2">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-400 to-violet-500 flex items-center justify-center font-bold text-zinc-950 text-[14px]">Cf</div>
            <div className="hidden sm:block">
              <div className="font-semibold tracking-tight leading-none">CircuitForge</div>
              <div className="text-[10px] text-zinc-500 tracking-widest uppercase">SPICE • Pot + Buzzer</div>
            </div>
            <div className="h-6 w-px bg-zinc-800 hidden sm:block mx-2" />
            <input value={projectName} onChange={e=>setProjectName(e.target.value)} className="bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-1.5 text-sm w-[120px] sm:w-[200px] focus:outline-none focus:border-zinc-700" placeholder="Project name" />
            <button onClick={loadBlinking} className="hidden xl:inline-flex text-[11px] px-2.5 py-1 rounded-full bg-zinc-900 border border-zinc-800 hover:border-zinc-700 text-zinc-400 hover:text-zinc-200 transition-colors">Blinking POT+Buzz</button>
          </div>

          <div className="flex items-center gap-1.5">
            <div className="hidden md:flex items-center gap-1 mr-1">
              <div className="flex rounded-full bg-zinc-900 border border-zinc-800 p-0.5">
                {(["schematic","breadboard","split"] as ViewMode[]).map(m=>(
                  <button key={m} onClick={()=> setViewMode(m)} className={`px-2.5 py-1 rounded-full text-[11px] capitalize transition-all ${viewMode===m? "bg-zinc-100 text-zinc-900 font-medium":"text-zinc-500 hover:text-zinc-300"}`}>{m}</button>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-1 bg-zinc-900 border border-zinc-800 rounded-full p-0.5">
              <button onClick={()=> {
                const willRun = !isRunning;
                if(willRun){
                  const ctx = ensureAudio();
                  if(ctx && ctx.state==="suspended") ctx.resume();
                } else {
                  // stop audio immediately on pause
                  try{ oscRef.current?.stop(); }catch{}
                  oscRef.current = null;
                  gainRef.current = null;
                }
                setIsRunning(v=>!v);
              }} className={`h-7 px-3 rounded-full text-[12px] font-semibold flex items-center gap-1.5 transition-all ${isRunning? "bg-emerald-500 text-zinc-950":"bg-zinc-100 text-zinc-900 hover:bg-white"}`}>
                <span className="text-[14px]">{isRunning ? "❚❚" : "▶"}</span>{isRunning ? "Pause" : "Play"}
              </button>
              <button onClick={()=> setIsMuted(v=>!v)} className={`h-7 w-7 grid place-items-center rounded-full text-[14px] transition-all ${isMuted? "bg-zinc-800 text-zinc-500":"bg-amber-400/15 text-amber-300 border border-amber-400/20"}`} title={isMuted?"Unmute buzzer":"Mute buzzer"}>
                {isMuted ? "🔇" : "🔔"}
              </button>
              <div className="w-px h-4 bg-zinc-800 hidden sm:block" />
              <span className="text-[10px] mono text-zinc-500 px-1 hidden sm:inline">{blinkFreq.toFixed(2)}Hz</span>
              <span className={`px-2 py-0.5 rounded-full text-[10px] border ${ledOn?"bg-red-500/15 border-red-500/30 text-red-300":"bg-zinc-800 border-zinc-700 text-zinc-500"}`}>{ledOn?"● ON":"○ OFF"}</span>
              <select value={speed} onChange={e=> setSpeed(parseFloat(e.target.value))} className="bg-transparent text-[11px] text-zinc-400 focus:outline-none pr-1 hidden sm:block">
                <option value={0.5}>0.5x</option><option value={1}>1x</option><option value={2}>2x</option>
              </select>
            </div>
            <div className="hidden md:flex items-center gap-1.5 ml-1">
              <div className={`w-2 h-2 rounded-full ${displayedResult?.errors?.some(e=>e.toLowerCase().includes("short"))?"bg-red-500 animate-pulse": isRunning?"bg-emerald-400 animate-pulse":"bg-zinc-700"}`} />
              <span className="text-[11px] text-zinc-500 mono">{Math.round(viewport.zoom*100)}%</span>
            </div>
            <button onClick={saveProject} className="h-8 px-3 rounded-lg bg-zinc-100 text-zinc-900 text-sm font-medium hover:bg-white transition-colors">Save</button>
            <button onClick={exportJSON} className="h-8 px-3 rounded-lg bg-zinc-900 border border-zinc-800 text-sm hover:bg-zinc-800 transition-colors hidden sm:inline-flex items-center">Export</button>
            <button onClick={runDC} className={`h-8 px-3 sm:px-4 rounded-lg text-sm font-semibold flex items-center gap-1.5 transition-all ${isSim? "bg-emerald-500 text-zinc-950":"bg-emerald-500 hover:bg-emerald-400 text-zinc-950 shadow-[0_0_20px_rgba(16,185,129,0.3)]"}`}>
              <span className="w-2 h-2 rounded-full bg-zinc-950 animate-pulse hidden sm:block" /> Run DC
            </button>
          </div>
        </div>
        <div className="h-10 border-t border-zinc-800 bg-zinc-900/60 flex items-center px-3 gap-2 text-[11px] overflow-x-auto">
          <div className="flex items-center gap-2">
            <span className="text-zinc-500 uppercase tracking-widest">Astable</span>
            <span className="px-2 py-0.5 rounded-full bg-violet-500/15 border border-violet-500/20 text-violet-300 mono">555 • R1 {(r1Val/1000).toFixed(0)}k • POT {(r2Val/1000).toFixed(0)}k • C {(cVal*1e6).toFixed(0)}uF • f={blinkFreq.toFixed(2)}Hz</span>
            <span className="px-2 py-0.5 rounded-full bg-zinc-900 border border-zinc-800 text-zinc-400 mono hidden md:inline">T={(1/blinkFreq).toFixed(2)}s • Phase {(phase*100).toFixed(0)}% • {ledOn? "LED ON 8.6V":"LED OFF 0.2V"} • {isBeeping?"🔔 880Hz BEEP":"🔇 mute"}</span>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <span className={`px-2 py-0.5 rounded-full text-[10px] border ${displayedResult?.converged? "bg-emerald-500/10 border-emerald-500/20 text-emerald-300":"bg-amber-500/10 border-amber-500/20 text-amber-300"}`}>{displayedResult? `${displayedResult.iterations} iters, ${Object.keys(displayedResult.nodeVoltages).length} nodes`:"Idle"}</span>
            <button onClick={()=> setShowSpicePanel(v=>!v)} className={`px-2.5 py-1 rounded-full border text-[11px] ${showSpicePanel? "bg-violet-500/15 border-violet-500/30 text-violet-200":"bg-zinc-900 border-zinc-800 text-zinc-400"}`}>SPICE {showSpicePanel?"×":"↗"}</button>
            <button onClick={()=> setShowCode(v=>!v)} className={`px-2.5 py-1 rounded-full border text-[11px] ${showCode? "bg-zinc-100 text-zinc-900":"bg-zinc-900 border-zinc-800 text-zinc-400"}`}>Engine</button>
          </div>
        </div>
      </header>

      <div className="flex flex-1 min-h-0">
        <aside className="w-[280px] hidden lg:flex flex-col border-r border-zinc-800 bg-zinc-900/50 backdrop-blur">
          <div className="p-3 border-b border-zinc-800">
            <div className="relative">
              <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search components…" className="w-full bg-zinc-950 border border-zinc-800 rounded-lg pl-8 pr-3 py-2 text-sm focus:outline-none focus:border-zinc-700" />
              <span className="absolute left-2.5 top-2.5 text-zinc-600">⌕</span>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-6">
            {CATEGORIES.map(cat=>{
              const items = Object.entries(filteredComponents).filter(([_,m]:any)=> (m as any).cat===cat);
              if(items.length===0) return null;
              return (
                <div key={cat}>
                  <h3 className="text-[10px] font-semibold tracking-[0.14em] text-zinc-500 uppercase mb-2.5 flex items-center gap-2"><span className="w-3 h-px bg-zinc-700" />{cat}</h3>
                  <div className="grid grid-cols-2 gap-2">
                    {items.map(([type, meta]: any)=>(
                      <div key={type} draggable onDragStart={e=>{ e.dataTransfer.setData("application/circuit-component", type); e.dataTransfer.effectAllowed="copy"; }} onClick={()=> addComponent(type as ComponentType)} className="group relative bg-zinc-900 border border-zinc-800 rounded-xl p-2.5 hover:border-zinc-700 hover:bg-zinc-800/80 transition-all cursor-grab active:cursor-grabbing">
                        <div className="w-full h-[48px] grid place-items-center bg-zinc-950 rounded-lg border border-zinc-900 group-hover:border-zinc-800 transition-colors">
                          <div className="scale-[0.6] origin-center"><SymbolSVG type={type as ComponentType} value={meta.value} compId={type} isBeeping={type==="buzzer" && isBeeping} /></div>
                        </div>
                        <div className="mt-2"><div className="text-[11px] font-medium leading-tight truncate text-zinc-200">{meta.name}</div><div className="text-[10px] mono text-zinc-500">{meta.value}</div></div>
                        <div className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full" style={{background:meta.color, opacity:0.8}} />
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="p-3 border-t border-zinc-800 space-y-2">
            <div className="rounded-xl bg-zinc-950 border border-zinc-800 p-3">
              <div className="text-[11px] font-medium text-zinc-300">Blinking LED • Pot + Buzzer</div>
              <div className="text-[11px] text-zinc-500 leading-snug mt-1">555 timer as astable: <span className="text-zinc-300 mono">f=1.44/((R1+2*R2)*C)</span>. POT R2 10k-100k adjusts blink. Buzzer parallel LED via 100Ω, 880Hz sine beeps when LED ON. Mute in top bar.</div>
              <div className="mt-2 grid grid-cols-3 gap-1 text-[10px] mono">
                <div className="px-2 py-1 rounded bg-zinc-900 border border-zinc-800">R1 {Math.round(r1Val/1000)}k</div>
                <div className="px-2 py-1 rounded bg-amber-400/10 border border-amber-400/20 text-amber-200">R2 {Math.round(r2Val/1000)}k</div>
                <div className="px-2 py-1 rounded bg-zinc-900 border border-zinc-800">C {(cVal*1e6).toFixed(0)}uF</div>
              </div>
            </div>
          </div>
        </aside>

        <div className="flex-1 flex flex-col min-w-0 bg-zinc-950 relative">
          <div className="lg:hidden h-10 border-b border-zinc-800 bg-zinc-900/50 flex items-center px-3 gap-2">
            <div className="flex rounded-full bg-zinc-950 border border-zinc-800 p-0.5">
              {(["schematic","breadboard","split"] as ViewMode[]).map(m=>(
                <button key={m} onClick={()=> setViewMode(m)} className={`px-3 py-1 rounded-full text-[11px] capitalize ${viewMode===m? "bg-zinc-100 text-zinc-900 font-medium":"text-zinc-500"}`}>{m}</button>
              ))}
            </div>
            <button onClick={()=> setIsRunning(v=>!v)} className={`ml-auto px-3 py-1 rounded-full text-[11px] font-semibold ${isRunning?"bg-emerald-500 text-zinc-950":"bg-zinc-800 text-zinc-300"}`}>{isRunning?"Pause":"Play"} • {ledOn?"ON":"OFF"}</button>
            <button onClick={()=> setIsMuted(v=>!v)} className={`px-2 py-1 rounded-full text-[11px] ${isMuted?"bg-zinc-800 text-zinc-500":"bg-amber-400/15 text-amber-300"}`}>{isMuted?"🔇":"🔔"}</button>
          </div>

          <div className={`flex-1 flex min-h-0 ${viewMode==="split"?"flex-col lg:flex-row":"flex-col"}`}>
            <div className={`${viewMode==="breadboard"?"hidden": viewMode==="split"?"flex-1 lg:w-1/2":"flex-1"} flex flex-col min-h-0 border-r border-zinc-800`}>
              <div className="h-10 border-b border-zinc-800 bg-zinc-900/50 flex items-center px-3 gap-2 text-[11px]">
                <span className="font-medium text-zinc-300">Schematic • Pot + Buzzer</span>
                <button onClick={()=> setViewport(v=>({...v, x:0,y:0,zoom:1}))} className="ml-2 px-2.5 py-1 rounded-full bg-zinc-900 border border-zinc-800 hover:bg-zinc-800">Reset</button>
                <span className="mono text-zinc-500 hidden sm:inline">{components.length} comps • {wires.length} nets • {blinkFreq.toFixed(2)}Hz</span>
                {displayedResult && <span className={`ml-auto px-2 py-0.5 rounded-full text-[10px] border ${displayedResult.converged? "bg-emerald-500/10 border-emerald-500/20 text-emerald-300":"bg-red-500/10 border-red-500/20 text-red-300"}`}>{isRunning? `${ledOn?"LED ON + BEEP":"LED OFF"} ${phase.toFixed(2)}` : "DC ready"}</span>}
              </div>
              <div ref={canvasRef} onMouseDown={handleCanvasMouseDown} onMouseMove={handleCanvasMouseMove} onMouseUp={handleCanvasMouseUp} onMouseLeave={()=>{ setPanning(null); setDragging(null); }} onWheel={handleWheel} onDragOver={e=> e.preventDefault()} onDrop={handleDrop} className="flex-1 relative overflow-hidden select-none" style={{ cursor: panning? "grabbing" : dragging? "grabbing" : selRect? "crosshair" : "default" }}>
                <div className="absolute inset-0 pointer-events-none" style={{ backgroundImage:`radial-gradient(circle at 1px 1px, #1e1e22 1px, transparent 0)`, backgroundSize:`${GRID*viewport.zoom}px ${GRID*viewport.zoom}px`, backgroundPosition:`${viewport.x}px ${viewport.y}px` }} />
                <svg className="absolute inset-0 w-full h-full pointer-events-none" style={{ overflow:"visible" }}>
                  <g style={{ transform:`translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})` }}>
                    {wires.map(w=>{
                      const fromComp = components.find(c=>c.id===w.from.compId); const toComp = components.find(c=>c.id===w.to.compId); if(!fromComp || !toComp) return null;
                      const a = getPinWorld(fromComp, w.from.pin); const b = getPinWorld(toComp, w.to.pin); const current = displayedResult?.branchCurrents[w.from.compId] || displayedResult?.branchCurrents[w.to.compId] || 0; const isPowered = displayedResult ? Math.abs(current)>1e-6 || (isRunning && (w.id.includes("out")||w.id.includes("led")||w.id.includes("bz")||w.id.includes("qc")) && ledOn) : false; const thickness = 2 + Math.min(Math.abs(current)*800 + (isRunning && ledOn? 1.5:0), 6); const pathD = bezier ? straightPath(a,b) : orthogonalPath(a,b, (parseInt(w.id.slice(-1),36)%5)*4 -8);
                      return (<g key={w.id}><path d={pathD} fill="none" stroke={isPowered? (ledOn? (w.id.includes("bz")?"#fbbf24":"#ef4444") : "#10b981") : w.color||"#3f3f46"} strokeWidth={thickness} strokeLinecap="round" strokeLinejoin="round" opacity={isPowered?1:0.65} />{isRunning && isPowered && (<circle r={2.5} fill={ledOn? (w.id.includes("bz")?"#fbbf24":"#ef4444"):"#10b981"}><animateMotion dur={`${(1/blinkFreq)/2}s`} repeatCount="indefinite" path={pathD} /></circle>)}</g>);
                    })}
                    {wiringFrom && (()=> { const comp = components.find(c=>c.id===wiringFrom.compId); if(!comp) return null; const a = getPinWorld(comp, wiringFrom.pin); const b = mouseWorld; const d = bezier ? straightPath(a,b) : orthogonalPath(a,b); return <path d={d} fill="none" stroke="#8b5cf6" strokeWidth={2} strokeDasharray="6 4" opacity={0.9} />; })()}
                  </g>
                </svg>
                {selRect && (<div className="absolute border border-violet-500/50 bg-violet-500/10 pointer-events-none" style={{ left: (Math.min(selRect.start.x, selRect.end.x)*viewport.zoom + viewport.x), top: (Math.min(selRect.start.y, selRect.end.y)*viewport.zoom + viewport.y), width: Math.abs(selRect.end.x - selRect.start.x)*viewport.zoom, height: Math.abs(selRect.end.y - selRect.start.y)*viewport.zoom, }} />)}
                <div className="absolute inset-0" style={{ transform:`translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`, transformOrigin:"0 0" }}>
                  {components.map(comp=>{
                    const isSelected = selectedIds.includes(comp.id); const isLit = !!(displayedResult?.litLEDs as any)?.[comp.id]; const hasPower = displayedResult ? Object.values(displayedResult.nodeVoltages).some(v=> Math.abs(v)>0.5) : false; const buzzing = comp.type==="buzzer" && isBeeping;
                    return (
                      <div key={comp.id} onMouseDown={e=>{ if(e.button!==0) return; e.stopPropagation(); const world = worldFromScreen(e.clientX, e.clientY); setDragging({ id: comp.id, off:{ x: world.x - comp.x, y: world.y - comp.y } }); if(!selectedIds.includes(comp.id)){ setSelectedIds(e.shiftKey? [...selectedIds, comp.id] : [comp.id]); } }} onClick={e=> e.stopPropagation()} className={`absolute select-none group ${isSelected? "z-10":"z-0"}`} style={{ left: comp.x, top: comp.y, transform:`translate(-50%,-50%) rotate(${comp.rotation}deg)` }}>
                        <div className={`relative rounded-xl border px-2 py-1 backdrop-blur transition-all ${isSelected? "border-violet-500/60 bg-zinc-900/90 shadow-[0_0_0_1px_rgba(139,92,246,0.2),0_8px_24px_rgba(0,0,0,0.5)]" : comp.type.startsWith("led") && isLit ? "border-red-500/50 bg-red-500/10 shadow-[0_0_20px_rgba(239,68,68,0.35)]" : comp.type==="buzzer" && buzzing ? "border-amber-400/60 bg-amber-400/10 shadow-[0_0_20px_rgba(251,191,36,0.4)]" : comp.type==="pot" ? "border-amber-400/20 bg-zinc-900/70" : "border-zinc-800 bg-zinc-900/70 hover:border-zinc-700"}`}>
                          <div className="flex flex-col items-center"><SymbolSVG type={comp.type} value={comp.value} isLit={isLit} isPowered={hasPower || (comp.type==="timer555" && isRunning) || (comp.type==="pot" && isRunning)} compId={comp.id} isBeeping={buzzing} /><div className="mt-1 flex items-center gap-1"><span className="text-[9px] mono text-zinc-400 tracking-wide">{comp.label}</span>{comp.type==="timer555" && isRunning && <span className="text-[8px] px-1 py-0.5 rounded-full bg-violet-500/20 text-violet-300 border border-violet-500/30 animate-pulse">{blinkFreq.toFixed(2)}Hz</span>}{comp.type==="buzzer" && buzzing && <span className="text-[8px] px-1 py-0.5 rounded-full bg-amber-400/20 text-amber-300 border border-amber-400/30 animate-pulse">♪ BEEP</span>}</div></div>
                          {PIN_DEFS[comp.type].map((pin, idx)=>{ const isWiringTarget = wiringFrom && wiringFrom.compId===comp.id && wiringFrom.pin===idx; const nodeId = displayedResult?.pinToNode[`${comp.id}:${idx}`]; const v = nodeId!==undefined ? displayedResult?.nodeVoltages[nodeId] : undefined; return (<div key={idx} onMouseDown={e=>{ e.stopPropagation(); }} onClick={e=> handlePinClick(comp.id, idx, e)} title={`${pin.label} n${nodeId??"?"} ${v!==undefined? v.toFixed(2)+"V":""}`} className={`absolute w-3 h-3 rounded-full border-2 grid place-items-center cursor-crosshair transition-all ${isWiringTarget? "bg-violet-500 border-violet-300 scale-125 shadow-[0_0_10px_#8b5cf6]" : wiringFrom? "bg-zinc-950 border-emerald-400 hover:scale-110" : "bg-zinc-950 border-zinc-600 group-hover:border-zinc-400 group-hover:bg-zinc-800"}`} style={{ left: pin.x - 6, top: pin.y - 6, transform:`rotate(${-comp.rotation}deg)` }}><div className={`w-1 h-1 rounded-full ${isWiringTarget? "bg-white":"bg-zinc-400"}`} /></div>); })}
                          {comp.type.startsWith("led") && (<div className={`absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full ${isLit? "bg-red-500 shadow-[0_0_10px_#ef4444] animate-pulse":"bg-zinc-700"}`} />)}
                          {comp.type==="buzzer" && buzzing && (<div className="absolute -top-2 -right-2 w-3 h-3 rounded-full bg-amber-400 shadow-[0_0_12px_#fbbf24] animate-ping" />)}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
            <div className={`${viewMode==="schematic"?"hidden": viewMode==="split"?"flex-1 lg:w-1/2":"flex-1"} flex flex-col min-h-0 bg-[#0e0e10]`}>
              <BreadboardView components={components} wires={wires} breadboardItems={breadboardItems} setBreadboardItems={setBreadboardItems} simResult={displayedResult} onSelectComp={(id)=> setSelectedIds([id])} />
            </div>
          </div>

          <div className="h-[320px] border-t border-zinc-800 bg-zinc-900/60 backdrop-blur flex flex-col">
            {/* Quick Blink Rate slider bar */}
            <div className="h-[56px] border-b border-zinc-800 bg-zinc-950/60 flex items-center px-3 gap-3 text-[11px] overflow-x-auto">
              <span className="font-semibold tracking-wide text-zinc-300 flex items-center gap-2"><span className="w-6 h-6 rounded-full bg-amber-400/10 border border-amber-400/20 grid place-items-center text-[12px]">◑</span> Blink Rate</span>
              <div className="flex items-center gap-3 flex-1 max-w-[520px]">
                <span className="mono text-zinc-500">10k</span>
                <input type="range" min={10000} max={100000} step={1000} value={r2Val} onChange={e=> handlePotChange(parseInt(e.target.value))} className="flex-1 accent-amber-400 h-1.5 bg-zinc-800 rounded-full appearance-none cursor-pointer" />
                <span className="mono text-zinc-500">100k</span>
              </div>
              <div className="flex items-center gap-2 ml-1">
                <span className="px-2.5 py-1 rounded-full bg-amber-400/10 border border-amber-400/20 text-amber-200 mono">{Math.round(r2Val/1000)}kΩ</span>
                <span className="px-2.5 py-1 rounded-full bg-violet-500/10 border border-violet-500/20 text-violet-200 mono">{blinkFreq.toFixed(2)} Hz</span>
                <span className="hidden md:inline text-zinc-500 mono">T={(1/blinkFreq).toFixed(2)}s = 1.44/(({(r1Val/1000).toFixed(0)}k+2×{Math.round(r2Val/1000)}k)×{(cVal*1e6).toFixed(0)}uF)</span>
                <button onClick={()=> setIsMuted(v=>!v)} className={`ml-2 h-7 px-3 rounded-full border text-[11px] flex items-center gap-1.5 ${isMuted? "bg-zinc-800 border-zinc-700 text-zinc-400":"bg-amber-400/15 border-amber-400/30 text-amber-200"}`}>{isMuted?"🔇 Muted":"🔔 Beep ON"}</button>
              </div>
            </div>
            <div className="flex flex-1 min-h-0">
              <div className="flex-1 flex flex-col min-w-0">
                <div className="h-8 flex items-center px-3 gap-2 border-b border-zinc-800 text-[11px]">
                  <span className="font-semibold tracking-wide text-zinc-300">Console • Pot + Buzzer Lab</span>
                  <span className="text-zinc-600">•</span>
                  <span className="text-zinc-500 mono">{logs.length} events</span>
                  <span className={`ml-2 px-2 py-0.5 rounded-full text-[10px] border ${isRunning?"bg-emerald-500/15 border-emerald-500/30 text-emerald-300":"bg-zinc-800 border-zinc-700 text-zinc-500"}`}>{isRunning?`Running ${blinkFreq.toFixed(2)}Hz t=${(currentTime/1000).toFixed(2)}s`:"Idle"}</span>
                  <button onClick={()=> setLogs([])} className="ml-auto px-2 py-0.5 rounded-full bg-zinc-800 border border-zinc-700 hover:bg-zinc-700">Clear</button>
                </div>
                <div className="flex-1 overflow-y-auto p-2 space-y-1 font-mono text-[11px]">
                  {logs.slice(-40).map((l,i)=>(<div key={i} className="flex gap-2"><span className="text-zinc-600">{l.t}</span><span className={`${l.kind==="error"? "text-red-400" : l.kind==="warn"? "text-amber-300" : l.kind==="success"? "text-emerald-300" : "text-zinc-400"}`}>{l.msg}</span></div>))}
                  {isRunning && <div className="flex gap-2"><span className="text-zinc-600">{new Date().toLocaleTimeString()}</span><span className="text-violet-300">555 OUT = {ledOn?"HIGH 8.2V → LED ON + BUZZER 880Hz":"LOW 0.2V → LED OFF"} • POT {Math.round(r2Val/1000)}kΩ → {blinkFreq.toFixed(2)}Hz • Phase {(phase*100).toFixed(0)}%</span></div>}
                </div>
              </div>
              <div className="w-[380px] hidden xl:flex flex-col border-l border-zinc-800 p-2 gap-2 overflow-y-auto">
                <LiveOscilloscope isRunning={isRunning} currentTime={currentTime} ledOn={ledOn} ledVoltage={ledVoltage} freq={blinkFreq} isBeeping={isBeeping} />
                <div className="rounded-xl bg-zinc-950 border border-zinc-800 p-3">
                  <div className="text-[11px] font-medium text-zinc-300 flex items-center justify-between">Behavioral 555 + Buzzer <span className="text-[10px] mono text-zinc-500">{blinkFreq.toFixed(2)}Hz</span></div>
                  <div className="mt-2 text-[11px] text-zinc-500 leading-snug">Square wave via <span className="text-zinc-300 mono">f=1.44/((R1+2×POT)×C)</span> re-read each frame. POT slider 10k-100k instantly changes <span className="text-zinc-300 mono">period={periodMs.toFixed(0)}ms</span>. Buzzer 880Hz sine with gain envelope when LED ON. Mute toggle preserves visual.</div>
                  <div className="mt-2 flex gap-1.5">
                    <button onClick={()=> {
                      const ctx = ensureAudio();
                      if(ctx && ctx.state==="suspended") ctx.resume();
                      setIsRunning(v=>!v);
                    }} className={`flex-1 h-8 rounded-lg text-[12px] font-semibold ${isRunning?"bg-zinc-800 border border-zinc-700 text-zinc-300":"bg-emerald-500 text-zinc-950"}`}>{isRunning?"Pause Blinking & Beep":"Play Blinking & Beep"}</button>
                    <button onClick={()=> { setCurrentTime(0); }} className="h-8 px-3 rounded-lg bg-zinc-900 border border-zinc-800 text-[11px]">Reset t</button>
                  </div>
                  <div className="mt-3">
                    <div className="text-[10px] text-zinc-500 uppercase tracking-widest mb-1.5">Potentiometer 10k-100k</div>
                    <input type="range" min={10000} max={100000} step={1000} value={r2Val} onChange={e=> handlePotChange(parseInt(e.target.value))} className="w-full accent-amber-400 h-1.5 bg-zinc-800 rounded-full appearance-none cursor-pointer" />
                    <div className="flex justify-between mt-1 text-[10px] mono text-zinc-500"><span>Slow 0.13Hz</span><span className="text-amber-200">{Math.round(r2Val/1000)}kΩ → {blinkFreq.toFixed(2)}Hz</span><span>Fast 1.3Hz</span></div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <aside className="w-[360px] hidden xl:flex flex-col border-l border-zinc-800 bg-zinc-900/50 backdrop-blur">
          <div className="p-4 border-b border-zinc-800">
            <h3 className="text-[11px] font-semibold tracking-[0.14em] text-zinc-500 uppercase">Properties • Pot + Buzzer</h3>
            {selectedComp ? (
              <div className="mt-4 space-y-4">
                <div className="flex items-center gap-3">
                  <div className="w-14 h-14 rounded-xl bg-zinc-950 border border-zinc-800 grid place-items-center"><div className="scale-[0.7]"><SymbolSVG type={selectedComp.type} value={selectedComp.value} isLit={!!(displayedResult?.litLEDs as any)?.[selectedComp.id]} isPowered={isRunning && (selectedComp.type==="timer555" || selectedComp.type==="pot")} compId={selectedComp.id} isBeeping={selectedComp.type==="buzzer" && isBeeping} /></div></div>
                  <div><div className="text-sm font-medium">{COMPONENT_META[selectedComp.type].name}</div><div className="text-[11px] mono text-zinc-500">{selectedComp.id} • {selectedComp.value} • {selectedComp.type==="timer555" ? `${blinkFreq.toFixed(2)}Hz` : selectedComp.type==="pot" ? `POT → ${blinkFreq.toFixed(2)}Hz` : ""}</div></div>
                </div>
                <div className="space-y-3">
                  <label className="block"><span className="text-[11px] text-zinc-500">Label</span><input value={selectedComp.label} onChange={e=> setComponents(cs=> cs.map(c=> c.id===selectedComp.id? {...c, label:e.target.value}:c))} className="mt-1 w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-zinc-700" /></label>
                  <label className="block"><span className="text-[11px] text-zinc-500">Value</span><input value={selectedComp.value} onChange={e=> setComponents(cs=> cs.map(c=> c.id===selectedComp.id? {...c, value:e.target.value}:c))} className="mt-1 w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm mono focus:outline-none focus:border-zinc-700" /></label>
                </div>

                {selectedComp.type==="pot" && (
                  <div className="rounded-xl bg-amber-950/20 border border-amber-900/30 p-3 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-medium text-amber-200">Potentiometer Blink Rate</span>
                      <span className="text-[10px] mono px-2 py-0.5 rounded-full bg-amber-400/15 border border-amber-400/20 text-amber-200">{Math.round(r2Val/1000)}kΩ</span>
                    </div>
                    <input type="range" min={10000} max={100000} step={1000} value={r2Val} onChange={e=> handlePotChange(parseInt(e.target.value))} className="w-full accent-amber-400 h-1.5 bg-zinc-800 rounded-full appearance-none cursor-pointer" />
                    <div className="grid grid-cols-2 gap-2 text-[11px] mono">
                      <div className="px-2.5 py-2 rounded-lg bg-zinc-950 border border-zinc-800 flex justify-between"><span className="text-zinc-500">Freq</span><span className="text-amber-200">{blinkFreq.toFixed(2)} Hz</span></div>
                      <div className="px-2.5 py-2 rounded-lg bg-zinc-950 border border-zinc-800 flex justify-between"><span className="text-zinc-500">Period</span><span className="text-zinc-200">{(1000/blinkFreq).toFixed(0)} ms</span></div>
                    </div>
                    <div className="text-[10px] mono text-zinc-500 leading-snug">Formula: <span className="text-zinc-300">f = 1.44 / ((R1+2×R2)×C)</span><br/>R1={Math.round(r1Val/1000)}k, R2={Math.round(r2Val/1000)}k, C={(cVal*1e6).toFixed(0)}uF → {blinkFreq.toFixed(3)}Hz live. Drag updates period instantly via requestAnimationFrame.</div>
                    <div className="flex gap-1.5">
                      {[10, 22, 47, 68, 100].map(k=>(
                        <button key={k} onClick={()=> handlePotChange(k*1000)} className={`flex-1 h-7 rounded-full text-[10px] border ${Math.round(r2Val/1000)===k? "bg-amber-400 text-zinc-950 border-amber-400 font-semibold":"bg-zinc-900 border-zinc-800 text-zinc-400 hover:bg-zinc-800"}`}>{k}k</button>
                      ))}
                    </div>
                  </div>
                )}

                {selectedComp.type==="buzzer" && (
                  <div className="rounded-xl bg-zinc-950 border border-zinc-800 p-3 space-y-2">
                    <div className="flex items-center justify-between"><span className="text-[11px] font-medium text-zinc-300">Buzzer 880Hz</span><span className={`text-[10px] px-2 py-0.5 rounded-full border ${isBeeping?"bg-amber-400/15 border-amber-400/30 text-amber-200":"bg-zinc-800 border-zinc-700 text-zinc-500"}`}>{isBeeping?"BEEPING":"IDLE"}</span></div>
                    <div className="text-[11px] text-zinc-500 leading-snug">Web Audio API oscillator sine 880Hz, gain envelope 0→0.22 in 15ms, stop with 50ms fade. Beeps only when LED ON and not muted. Top bar Play counts as user gesture for AudioContext.resume().</div>
                    <button onClick={()=> setIsMuted(v=>!v)} className={`w-full h-8 rounded-lg text-[12px] font-medium border ${isMuted? "bg-zinc-900 border-zinc-800 text-zinc-400":"bg-amber-400/15 border-amber-400/30 text-amber-200"}`}>{isMuted?"🔇 Unmute Buzzer":"🔔 Mute Buzzer"}</button>
                  </div>
                )}

                {displayedResult && (
                  <div className="rounded-xl bg-zinc-950 border border-zinc-800 p-3">
                    <div className="text-[11px] font-medium text-zinc-300">Operating Point {isRunning? <span className="text-emerald-300">• Live {blinkFreq.toFixed(2)}Hz</span> : null}</div>
                    <div className="mt-2 space-y-1 text-[11px] mono">
                      <div className="flex justify-between"><span className="text-zinc-500">LED State</span><span className={displayedResult.litLEDs[selectedComp.id] ? "text-red-300" : "text-zinc-500"}>{displayedResult.litLEDs[selectedComp.id] ? "ON (glowing)" : selectedComp.type==="buzzer" && isBeeping ? "BEEPING 880Hz" : "OFF"}</span></div>
                      <div className="flex justify-between"><span className="text-zinc-500">Current</span><span className="text-zinc-200">{(displayedResult.branchCurrents[selectedComp.id]??0).toExponential(2)} A</span></div>
                      <div className="flex justify-between"><span className="text-zinc-500">Power</span><span className="text-zinc-200">{(displayedResult.branchPower[selectedComp.id]??0).toFixed(4)} W</span></div>
                      {(PIN_DEFS[selectedComp.type]||[]).map((_,idx)=>{ const nid=displayedResult.pinToNode[`${selectedComp.id}:${idx}`]; const v=nid!==undefined? displayedResult.nodeVoltages[nid]:undefined; return <div key={idx} className="flex justify-between"><span className="text-zinc-500">Pin {idx} {PIN_DEFS[selectedComp.type][idx]?.label} n{nid}</span><span className="text-emerald-300">{v!==undefined? v.toFixed(3)+"V":"?"}</span></div>; })}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="mt-6 text-center py-8 rounded-xl bg-zinc-950 border border-dashed border-zinc-800"><div className="text-xs text-zinc-500">Select a component • Pot for blink rate, Buzzer for beep</div></div>
            )}
          </div>
          {showSpicePanel && (
            <div className="flex-1 flex flex-col min-h-0">
              <div className="p-3 border-b border-zinc-800 flex items-center justify-between">
                <h3 className="text-[11px] font-semibold tracking-[0.14em] text-zinc-500 uppercase">SPICE • Pot+Buzzer</h3>
                <div className="flex gap-1.5">
                  <button onClick={()=> { const blob=new Blob([netlistEdit],{type:"text/plain"}); const url=URL.createObjectURL(blob); const a=document.createElement("a"); a.href=url; a.download=`${projectName}.cir`; a.click(); URL.revokeObjectURL(url); }} className="px-2.5 py-1 rounded-full bg-zinc-800 border border-zinc-700 text-[11px] hover:bg-zinc-700">Export .cir</button>
                  <button onClick={runDC} className="px-2.5 py-1 rounded-full bg-emerald-500 text-zinc-950 text-[11px] font-semibold">Run DC</button>
                </div>
              </div>
              <textarea value={netlistEdit} onChange={e=> setNetlistEdit(e.target.value)} className="flex-1 w-full bg-zinc-950 p-3 text-[11px] mono text-zinc-300 focus:outline-none resize-none" spellCheck={false} />
              <div className="p-3 border-t border-zinc-800 space-y-3 overflow-y-auto max-h-[48%]">
                <LiveOscilloscope isRunning={isRunning} currentTime={currentTime} ledOn={ledOn} ledVoltage={ledVoltage} freq={blinkFreq} isBeeping={isBeeping} />
                {displayedResult && (
                  <div className="space-y-2">
                    <div className="rounded-lg bg-zinc-950 border border-zinc-800 p-2.5"><div className="text-[10px] text-zinc-500 uppercase">Node Voltages (pot {Math.round(r2Val/1000)}k → {blinkFreq.toFixed(2)}Hz)</div><div className="mt-1 space-y-1 max-h-[100px] overflow-y-auto">{Object.entries(displayedResult.nodeVoltages).map(([nid,v])=>(<div key={nid} className="flex justify-between text-[11px] mono"><span className="text-zinc-500">n{nid}</span><span className={Math.abs(v)>0.1? "text-emerald-300":"text-zinc-500"}>{v.toFixed(3)} V</span></div>))}</div></div>
                    <div className="rounded-lg bg-zinc-950 border border-zinc-800 p-2.5"><div className="text-[10px] text-zinc-500 uppercase">LED + Buzzer</div><div className="mt-1 text-[11px] mono text-zinc-300">Phase {(phase*100).toFixed(0)}% • {ledOn? "ON glowing #ef4444 + BEEP 880Hz":"OFF dim"} • V={ledVoltage.toFixed(1)}V • Pot {Math.round(r2Val/1000)}kΩ • f=1.44/((10k+2×{Math.round(r2Val/1000)}k)×10uF)</div></div>
                  </div>
                )}
              </div>
            </div>
          )}
        </aside>
      </div>

      {showCode && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-zinc-950/80 backdrop-blur-xl pt-[max(1rem,var(--safe-area-inset-top))]">
          <div className="min-h-full flex items-center justify-center p-4"><div className="w-full max-w-[1100px] rounded-[20px] border border-zinc-800 bg-zinc-900 shadow-2xl overflow-hidden">
            <div className="h-12 border-b border-zinc-800 flex items-center px-4 gap-2"><div className="flex items-center gap-2"><div className="w-3 h-3 rounded-full bg-red-500" /><div className="w-3 h-3 rounded-full bg-amber-400" /><div className="w-3 h-3 rounded-full bg-emerald-500" /></div><span className="ml-4 text-sm font-medium text-zinc-300">Blinking LED • Pot + Buzzer Engine</span><button onClick={()=> setShowCode(false)} className="ml-auto h-7 px-3 rounded-full bg-zinc-800 border border-zinc-700 text-xs">Close</button></div>
            <div className="flex min-h-[540px]"><div className="w-[260px] border-r border-zinc-800 bg-zinc-950/50 p-2 space-y-1 overflow-y-auto">{Object.keys(codeFiles).map(f=>(<button key={f} onClick={()=> setActiveFile(f)} className={`w-full text-left px-3 py-2 rounded-lg text-[12px] mono truncate ${activeFile===f? "bg-zinc-800 text-zinc-100 border border-zinc-700":"text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900"}`}>{f}</button>))}</div><div className="flex-1 bg-zinc-950 p-4 overflow-auto"><pre className="text-[12px] leading-[1.6] text-zinc-300 whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{codeFiles[activeFile]}</pre></div></div>
          </div></div>
        </div>
      )}
    </div>
  );
}
