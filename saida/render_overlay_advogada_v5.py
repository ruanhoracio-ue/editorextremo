import math, os, sys, json
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter
W,H,FPS,N=1080,1920,30,597
FONTS="/tmp/claude-0/-home-user-editorextremo/f24ac11d-f2d9-54d0-9f8e-c6b5f70c16cc/scratchpad/fonts"
INTER="/usr/share/fonts/opentype/inter"
CITY=os.environ.get("CITY","São Ludgero")
CUT=os.environ.get("CUT","cut5")
OUT=os.environ.get("OUT","ovl5")
HEAD_TOP=float(os.environ.get("HEAD_TOP","560"))
TRK_SERIF=-0.045; TRK_SANS=-0.055; LINEGAP=0.74; LEAD=0.06; T0=0.9
WORDS=json.load(open("../bruto/words.json"))
def wt(i): return WORDS[i]["s"]-T0-LEAD
_fc={}
def font(kind,size):
    k=(kind,size)
    if k in _fc: return _fc[k]
    if kind=="sans": f=ImageFont.truetype(f"{INTER}/InterDisplay-Medium.otf",size)
    elif kind=="sansb": f=ImageFont.truetype(f"{INTER}/InterDisplay-SemiBold.otf",size)
    else:
        f=ImageFont.truetype(f"{FONTS}/Cormorant-Italic.ttf",size)
        try: f.set_variation_by_axes([600])
        except Exception: pass
    _fc[k]=f; return f
# line = (text, kind, size, word_indices)
B=[
 (2.50,[("já pensou receber","sans",66,[0,1,2]),("a notícia","serif",170,[3,4])],{}),
 (4.20,[("dinheiro","serif",330,[8])],{"behind":True,"cy":310}),
 (4.20,[("que você tem para receber","sansb",70,[5,6,7,9,10])],{"cy":1300}),
 (5.40,[("e não sabe?","sansb",100,[11,12,13])],{}),
 (7.20,[("isso pode acontecer","sans",66,[14,15,16]),("com você,","serif",170,[17,18])],{}),
 (9.15,[("servidor público","sans",70,[19,20]),("de "+CITY,"serif",150,[21,22,23])],{}),
 (10.55,[("esse direito","sans",70,[24,25]),("é seu","serif",210,[26,27])],{}),
 (11.52,[("você pode consultá-lo","sansb",80,[29,30,31])],{}),
 (12.70,[("sem custo","serif",300,[33,34])],{"behind":True,"cy":380}),
 (12.70,[("nenhum.","sansb",110,[35])],{"cy":1300}),
 (15.15,[("clique no botão","sans",70,[36,37,38]),("na sua tela","serif",160,[42,43,44])],{"cy":1180}),
 (16.55,[("preenche","sans",70,[45]),("o formulário","serif",160,[46,47])],{}),
 (18.35,[("e nosso time","sans",66,[48,49,50]),("entrará em contato","serif",140,[51,52,53])],{}),
 (19.90,[("e em breve","sans",70,[54,55,56]),("com você.","serif",180,[57,58])],{}),
]
for i,(e,lines,opt) in enumerate(B):
    s=min(wt(w) for l in lines for w in l[3])
    B[i]=(s,e,lines,opt)
BTN=(12.85,15.25)
def ease_out(x): x=max(0.0,min(1.0,x)); return 1-(1-x)**3
GOLD=[(0,(255,246,205)),(0.3,(236,202,110)),(0.5,(255,238,170)),(0.78,(196,146,46)),(1,(140,98,24))]
def gold_grad(w,h):
    g=Image.new("RGBA",(w,h)); px=g.load()
    for y in range(h):
        p=y/max(1,h-1)
        for i in range(len(GOLD)-1):
            a,ca=GOLD[i]; b,cb=GOLD[i+1]
            if a<=p<=b: q=(p-a)/(b-a); c=tuple(int(ca[j]+(cb[j]-ca[j])*q) for j in range(3)); break
        for x in range(w): px[x,y]=c+(255,)
    return g
def text_width(f,t,trk): return sum(f.getlength(c) for c in t)+trk*max(0,len(t)-1)
def draw_tracked(d,x,y,t,f,trk):
    for c in t: d.text((x,y),c,font=f,fill=255,anchor="ls"); x+=f.getlength(c)+trk
    return x
def make_unit(m,bb,kind,sz,bl,pad):
    bb=(max(0,bb[0]-pad),max(0,bb[1]-pad),min(m.width,bb[2]+pad),min(m.height,bb[3]+pad))
    sub=m.crop(bb); u=Image.new("RGBA",sub.size,(0,0,0,0))
    sh=Image.new("RGBA",sub.size,(0,0,0,0)); sh.putalpha(sub.filter(ImageFilter.GaussianBlur(8)).point(lambda v:int(v*0.6)))
    u.alpha_composite(sh,(0,6))
    if kind=="serif":
        g=gold_grad(sub.width,int(sz*1.1)); gl=Image.new("RGBA",sub.size,(0,0,0,0))
        gl.paste(g,(0,int(bl-sz*0.78)-bb[1])); gl.putalpha(sub); u.alpha_composite(gl)
    else:
        wl=Image.new("RGBA",sub.size,(255,255,255,0)); wl.putalpha(sub); u.alpha_composite(wl)
    # pre-blurred variants for entry
    return {"img":u,"blur":[u,u.filter(ImageFilter.GaussianBlur(2)),u.filter(ImageFilter.GaussianBlur(5)),u.filter(ImageFilter.GaussianBlur(9))],"x":bb[0],"y":bb[1]}
_bc={}
def build_block(bi):
    if bi in _bc: return _bc[bi]
    s,e,lines,opt=B[bi]; behind=opt.get("behind")
    pad=80
    widths=[text_width(font(k,sz),t,(TRK_SERIF if k=="serif" else TRK_SANS)*sz) for t,k,sz,_ in lines]
    cw=int(max(widths))+pad*2
    y=pad; baselines=[]
    for i,(t,k,sz,_) in enumerate(lines):
        asc,desc=font(k,sz).getmetrics(); y+= asc if i==0 else sz*LINEGAP; baselines.append(y)
    ch=int(y+lines[-1][2]*0.35+pad)
    units=[]; smask=np.zeros((ch,cw),np.uint8); 
    for (t,k,sz,widx),bl,wd in zip(lines,baselines,widths):
        f=font(k,sz); trk=(TRK_SERIF if k=="serif" else TRK_SANS)*sz; x=(cw-wd)/2
        words=t.split(" ")
        for wi,w_ in enumerate(words):
            t_on=wt(widx[min(wi,len(widx)-1)])
            if behind:
                # letter by letter
                li=0
                for c in w_:
                    m=Image.new("L",(cw,ch),0); ImageDraw.Draw(m).text((x,bl),c,font=f,fill=255,anchor="ls")
                    bb=m.getbbox()
                    if bb:
                        u=make_unit(m,bb,k,sz,bl,24); u.update(t=t_on+li*0.05,dur=0.3,kind=k,rise=30); units.append(u)
                        smask=np.maximum(smask,np.array(m))
                    x+=f.getlength(c)+trk; li+=1
            else:
                m=Image.new("L",(cw,ch),0); draw_tracked(ImageDraw.Draw(m),x,bl,w_,f,trk)
                bb=m.getbbox()
                if bb:
                    u=make_unit(m,bb,k,sz,bl,24); u.update(t=t_on,dur=(0.22 if k=="serif" else 0.16),kind=k,rise=0); units.append(u)
                    if k=="serif": smask=np.maximum(smask,np.array(m))
                x+=text_width(f,w_,trk)
            x+=f.getlength(" ")+trk*2
    sm=Image.fromarray(smask); _bc[bi]=(cw,ch,units,sm,sm.getbbox()); return _bc[bi]
def render_block(bi,t):
    s,e,lines,opt=B[bi]
    cw,ch,units,smask,sbox=build_block(bi)
    img=Image.new("RGBA",(cw,ch),(0,0,0,0))
    out=ease_out((e-t)/0.16)
    for u in units:
        p=ease_out((t-u["t"])/u["dur"]); a=p*out
        if a<=0: continue
        bi_=0 if p>0.85 else (1 if p>0.6 else (2 if p>0.3 else 3))
        im=u["blur"][bi_]
        sc=1+0.05*(1-p)
        if sc>1.005:
            im=im.resize((int(im.width*sc),int(im.height*sc)),Image.BILINEAR)
        if a<1:
            im=im.copy(); im.putalpha(im.getchannel("A").point(lambda v:int(v*a)))
        ox=int(u["x"]-(im.width-u["img"].width)/2); oy=int(u["y"]-(im.height-u["img"].height)/2+(1-p)*u["rise"])
        img.alpha_composite(im,(ox,oy))
    if sbox:
        t_last=max(u["t"]+u["dur"] for u in units if u["kind"]=="serif")
        sh_t=(t-t_last-0.2)/0.8
        if 0<sh_t<1:
            band=Image.new("L",(cw,ch),0); d=ImageDraw.Draw(band)
            bw=sbox[2]-sbox[0]; cx=sbox[0]+(sh_t*1.4-0.2)*bw; w2=max(40,int(bw*0.16))
            for i in range(w2):
                v=int(255*(1-abs(i-w2/2)/(w2/2))**1.5*0.75); xx=int(cx-w2/2+i)
                d.line([(xx+ch*0.35,0),(xx-ch*0.35,ch)],fill=v,width=2)
            band=Image.fromarray(np.minimum(np.array(band),np.array(smask))).point(lambda v:int(v*out))
            hi=Image.new("RGBA",(cw,ch),(255,252,235,0)); hi.putalpha(band); img.alpha_composite(hi)
    return img
def draw_button(canvas,t):
    s,e=BTN
    if not (s<=t<=e): return
    a=ease_out((t-s)/0.3)*ease_out((e-t)/0.2); pulse=1+0.02*math.sin((t-s)*2*math.pi*1.2)
    bw,bh=int(520*pulse),int(112*pulse); cx,cy=540,1500
    layer=Image.new("RGBA",(W,H),(0,0,0,0)); d=ImageDraw.Draw(layer)
    d.rounded_rectangle((cx-bw//2,cy-bh//2,cx+bw//2,cy+bh//2),radius=bh//2,fill=(10,10,10,150),outline=(222,184,86,255),width=3)
    d.text((cx,cy+2),"QUERO CONSULTAR",font=font("sans",40),fill=(246,226,160,255),anchor="mm")
    ch_y=cy+bh//2+40+int(8*math.sin((t-s)*2*math.pi*1.5))
    d.line([(cx-22,ch_y),(cx,ch_y+16),(cx+22,ch_y)],fill=(222,184,86,255),width=5,joint="curve")
    layer.putalpha(layer.getchannel("A").point(lambda v:int(v*a))); canvas.alpha_composite(layer)
def main(out=OUT,start=0,end=N):
    os.makedirs(out,exist_ok=True)
    for n in range(start,end):
        t=n/FPS
        canvas=Image.new("RGBA",(W,H),(0,0,0,0))
        active=[i for i,b in enumerate(B) if b[0]<=t<=b[1]]
        def put(i):
            img=render_block(i,t); cy=B[i][3].get("cy",1250)

            canvas.alpha_composite(img,(540-img.width//2,cy-img.height//2))
        beh=[i for i in active if B[i][3].get("behind")]
        for i in beh: put(i)
        if beh:
            cf=f"{CUT}/f_{n:04d}.png"
            if os.path.exists(cf): canvas.alpha_composite(Image.open(cf).convert("RGBA"))
        for i in active:
            if i not in beh: put(i)
        draw_button(canvas,t)
        canvas.save(f"{out}/o_{n:04d}.png")
        if n%50==0: print(n,flush=True)
if __name__=="__main__":
    a=sys.argv[1:]; main(OUT,int(a[0]) if a else 0,int(a[1]) if len(a)>1 else N)
