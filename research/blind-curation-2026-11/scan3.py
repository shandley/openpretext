import re, subprocess, sys, urllib.parse, concurrent.futures as cf
def scan(p):
    out, tok = [], None
    while True:
        url = 'https://genomeark.s3.amazonaws.com/?list-type=2&prefix=' + urllib.parse.quote(p + 'assembly_curated/', safe='/')
        if tok: url += '&continuation-token=' + urllib.parse.quote(tok, safe='')
        r = ''
        for _ in range(4):
            r = subprocess.run(['curl', '-s', '--max-time', '40', url], capture_output=True, text=True).stdout
            if '</ListBucketResult>' in r: break
            r = ''
        if not r: return p, None
        for block in re.findall(r'<Contents>(.*?)</Contents>', r, re.S):
            out.append((re.search(r'<Key>([^<]*)', block).group(1), re.search(r'<Size>(\d+)', block).group(1)))
        m = re.search(r'<NextContinuationToken>([^<]*)', r)
        if not m: return p, out
        tok = m.group(1)
ids = [l.strip() for l in open('ids.txt') if l.strip()]
failed = 0
with cf.ThreadPoolExecutor(8) as ex, open('curated-all.tsv', 'w') as f:
    for p, out in ex.map(scan, ids):
        if out is None: failed += 1; continue
        for k, s in out: f.write(f'{k}\t{s}\n')
print('failed', failed)
