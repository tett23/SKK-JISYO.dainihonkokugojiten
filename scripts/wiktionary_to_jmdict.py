"""Wiktionary（kaikki.org の日本語の抽出）を JMdict と同じ XML の形にする（試行用）"""
import sys,json,gzip,re,html
HAN=re.compile(r'[㐀-鿿豈-﫿\U00020000-\U0002ffff々]')
kata2hira=lambda s:''.join(chr(ord(c)-0x60) if 'ァ'<=c<='ヶ' else c for c in s)
out=gzip.open(sys.argv[2],'wt'); n=0
for l in gzip.open(sys.argv[1],'rt'):
    x=json.loads(l); w=x.get('word','')
    if not HAN.search(w) or x.get('pos') in ('character','romanization','soft-redirect','name'): continue
    reads=[];old=[];kebs={w}
    for f in x.get('forms',[]):
        t=f.get('tags',[])
        if 'canonical' in t and f.get('ruby'):
            form=f['form'].replace(' ^','').strip()
            # ruby の付かない仮名はそのまま
            r=''; rb=list(f['ruby']); i=0; ok=True
            s=form
            while s:
                if rb and s.startswith(rb[0][0]): r+=rb[0][1]; s=s[len(rb[0][0]):]; rb.pop(0)
                elif HAN.match(s[0]): ok=False; break
                else: r+=s[0]; s=s[1:]
            if ok and not rb: reads.append(kata2hira(r)); kebs.add(form)
        elif 'historical' in t and 'hiragana' in t: old.append(f['form'])
        elif 'alternative' in t and 'kanji' in t and HAN.search(f.get('form','')): kebs.add(f['form'])
    reads=[r for r in dict.fromkeys(reads) if re.fullmatch(r'[ぁ-ゖー]+',r)]
    old=[r for r in dict.fromkeys(old) if re.fullmatch(r'[ぁ-ゖー]+',r) and r not in reads]
    if not reads: continue
    p=x.get('pos'); pos='n'
    if p=='adj':
        # 文語の形容詞（あらあらし）は JMdict の品詞に合わないので除く
        if not w.endswith('い'): continue
        pos='adj-i'
    elif p=='verb':
        ty=str((x.get('head_templates') or [{}])[0].get('args',{}).get('type',''))
        pos='v1' if ty=='2' else 'v5'
    out.write('<entry>'+''.join(f'<k_ele><keb>{html.escape(k)}</keb></k_ele>' for k in sorted(kebs))
      +''.join(f'<r_ele><reb>{r}</reb></r_ele>' for r in reads)+''.join(f'<r_ele><reb>{r}</reb><re_inf>&ok;</re_inf></r_ele>' for r in old)
      +f'<sense><pos>&{pos};</pos></sense></entry>\n'); n+=1
out.close(); print(n)
