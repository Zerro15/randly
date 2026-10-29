(function(root, factory) {
  const api = factory(root.crypto);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root.window) root.window.RandlyCore = api;
})(globalThis, function(cryptoApi) {
  'use strict';
  function randomBelow(limit) {
    const n=BigInt(limit);if(n<=0n)throw Error('Диапазон должен быть положительным');
    const space=1n<<64n,cutoff=space-space%n,words=new Uint32Array(2);let value;
    do{cryptoApi.getRandomValues(words);value=(BigInt(words[0])<<32n)|BigInt(words[1]);}while(value>=cutoff);
    return value%n;
  }
  function chooseIndex(length){if(!Number.isSafeInteger(length)||length<1)throw Error('Пустой список вариантов');return Number(randomBelow(BigInt(length)));}
  function secureShuffle(values){const a=[...values];for(let i=a.length-1;i>0;i--){const j=chooseIndex(i+1);[a[i],a[j]]=[a[j],a[i]];}return a;}
  function randomInteger(lo,hi,excluded=[]){lo=BigInt(lo);hi=BigInt(hi);if(lo>hi)[lo,hi]=[hi,lo];const size=hi-lo+1n,skip=[...new Set(excluded.map(String))].map(BigInt).filter(x=>x>=lo&&x<=hi).sort((a,b)=>a<b?-1:1);if(size<=BigInt(skip.length))throw Error('Все числа в диапазоне исключены');let candidate=lo+randomBelow(size-BigInt(skip.length));for(const x of skip){if(x<=candidate)candidate++;else break;}return Number(candidate);}
  function uniqueNumbers(lo,hi,count,excluded=[]){lo=BigInt(lo);hi=BigInt(hi);if(lo>hi)[lo,hi]=[hi,lo];if(!Number.isInteger(count)||count<0)throw Error('Недопустимое количество');const size=hi-lo+1n,used=new Set([...new Set(excluded.map(String))].map(BigInt).filter(x=>x>=lo&&x<=hi).map(String));if(size-BigInt(used.size)<BigInt(count))throw Error('Недостаточно доступных чисел для выбора без повторов');const out=[];for(let i=0;i<count;i++){const blocked=[...used].map(BigInt).sort((a,b)=>a<b?-1:1);let n=lo+randomBelow(size-BigInt(used.size));for(const x of blocked){if(x<=n)n++;else break;}used.add(String(n));out.push(Number(n));}return out;}
  function weightedInteger(lo,hi,blocked,weights){lo=BigInt(lo);hi=BigInt(hi);const size=hi-lo+1n,skips=[...new Set([...blocked.map(String),...[...weights].filter(([,w])=>w===0).map(([n])=>String(n))])].map(BigInt).filter(n=>n>=lo&&n<=hi).sort((a,b)=>a<b?-1:1);const overrides=[...weights].filter(([n,w])=>w>0&&n>=lo&&n<=hi&&!skips.includes(n)).sort((a,b)=>a[0]<b[0]?-1:1);const baseBlocks=new Set([...skips,...overrides.map(([n])=>n)].map(String)),baseCount=size-BigInt(baseBlocks.size),extra=overrides.reduce((s,[,w])=>s+BigInt(w),0n);if(baseCount+extra<=0n)throw Error('Нет доступных значений');let roll=randomBelow(baseCount+extra);if(roll>=baseCount){roll-=baseCount;for(const [n,w] of overrides){if(roll<BigInt(w))return Number(n);roll-=BigInt(w);}throw Error('Не удалось применить веса');}let candidate=lo+roll;for(const n of [...baseBlocks].map(BigInt).sort((a,b)=>a<b?-1:1)){if(n<=candidate)candidate++;else break;}return Number(candidate);}
  return {randomBelow,chooseIndex,secureShuffle,randomInteger,uniqueNumbers,weightedInteger};
});
