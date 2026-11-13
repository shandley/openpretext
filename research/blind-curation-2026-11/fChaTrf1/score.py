import hashlib,sys
comp=str.maketrans('ACGTacgtNn','TGCAtgcaNn')
def recs(p):
    name=None;buf=[]
    for l in open(p):
        if l[0]=='>':
            if name: yield name,''.join(buf)
            name=l[1:].split()[0];buf=[]
        else: buf.append(l.strip())
    if name: yield name,''.join(buf)
def canon(p):
    d={}
    for n,s in recs(p):
        s=s.upper(); r=s.translate(comp)[::-1]
        d[hashlib.md5(min(s,r).encode()).hexdigest()]=(n,len(s))
    return d
for part in ('hap_1s','hap_2s','primary'):
    a=canon(f'asm-curator/fChaTrf1.1.{part}.fa'); b=canon(f'asm-blind/fChaTrf1.1.{part}.fa')
    chrA={h:v for h,v in a.items() if v[0].startswith('SUPER') and 'unloc' not in v[0]}
    chrB={h:v for h,v in b.items() if v[0].startswith('SUPER') and 'unloc' not in v[0]}
    same=set(chrA)&set(chrB)
    print(part,'sequences curator/blind',len(a),len(b),'| chromosomes',len(chrA),len(chrB),'identical (either strand)',len(same),'| all identical records',len(set(a)&set(b)))
    print('   bp in chromosomes curator',sum(v[1] for v in chrA.values()),'blind',sum(v[1] for v in chrB.values()),'bp in identical chromosomes',sum(chrA[h][1] for h in same))
    print('   curator-only chromosomes:',sorted(v for h,v in chrA.items() if h not in same))
    print('   blind-only chromosomes:',sorted(v for h,v in chrB.items() if h not in same))
