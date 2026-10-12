import math, os, sys
from PIL import Image, ImageDraw, ImageFont, ImageFilter
W,H,FPS,N=1080,1920,30,597
FONTS="/tmp/claude-0/-home-user-editorextremo/f24ac11d-f2d9-54d0-9f8e-c6b5f70c16cc/scratchpad/fonts"
INTER="/usr/share/fonts/opentype/inter"
CITY=os.environ.get("CITY","São Ludgero")
SERIF=os.environ.get("SERIF","cormorant")
_fc={}
def font(kind,size):
    k=(kind,size)
    if k in _fc: return _fc[k]
    if kind=="sans": f=ImageFont.truetype(f"{INTER}/InterDisplay-Medium.otf",size)
    elif kind=="sansb": f=ImageFont.truetype(f"{INTER}/InterDisplay-SemiBold.otf",size)
    else:
        if SERIF=="cormorant":
            f=ImageFont.truetype(f"{FONTS}/Cormorant-Italic.ttf",size); wght=600
        else:
            f=ImageFont.truetype(f"{FONTS}/EBGaramond-Italic[wght].ttf",size); wght=500
        try: f.set_variation_by_axes([wght])
        except Exception: pass
    _fc[k]=f; return f
# block: (start,end,line1,line2,opts). line = (text,kind,size) or None
B=[
 (0.34,2.50,("já pensou receber","sans",66),("a notícia","serif",170),{}),
 (2.55,4.20,("dinheiro","serif",330),None,{"behind":True,"cy":800}),
 (2.55,4.20,("que você tem para receber","sansb",70),None,{"cy":1300}),
 (4.45,5.40,("e não sabe?","sansb",100),None,{}),
 (5.58,7.20,("isso pode acontecer","sans",66),("com você,","serif",170),{}),
 (7.26,9.15,("servidor público","sans",70),("de "+CITY,"serif",150),{}),
 (9.26,10.55,("esse direito","sans",70),("é seu","serif",210),{}),
 (10.58,11.52,("você pode consultá-lo","sansb",80),None,{}),
 (11.56,12.70,("sem custo","serif",300),None,{"behind":True,"cy":800}),
 (11.56,12.70,("nenhum.","sansb",110),None,{"cy":1300}),
 (12.78,15.15,("clique no botão","sans",70),("na sua tela","serif",160),{"cy":1180}),
 (15.42,16.55,("preenche","sans",70),("o formulário","serif",160),{}),
 (16.62,18.35,("e nosso time","sans",66),("entrará em contato","serif",140),{}),
 (18.46,19.90,("e em breve","sans",70),("com você.","serif",180),{}),
]
BTN=(12.85,15.25)
CUT="cut2"
def ease_out(x): x=max(0.0,min(1.0,x)); return 1-(1-x)**3
def ease_io(x): x=max(0.0,min(1.0,x)); return x*x*(3-2*x)
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
_bc={}
TRK_SERIF=float(os.environ.get("TRK_SERIF","-0.045"))
TRK_SANS=float(os.environ.get("TRK_SANS","-0.055"))
def text_width(f,t,trk):
    return sum(f.getlength(c) for c in t)+trk*max(0,len(t)-1)
def draw_tracked(draw,x,y,t,f,trk):
    for c in t:
        draw.text((x,y),c,font=f,fill=255,anchor="ls"); x+=f.getlength(c)+trk
    return x
def build_block(bi):
    """precompute units: list of (img, x, y, index, kind) laid out in a block canvas; plus serif mask for shimmer"""
    if bi in _bc: return _bc[bi]
    s,e,l1,l2,opt=B[bi]
    lines=[l for l in (l1,l2) if l]
    pad=70
    widths=[text_width(font(k,sz),t,(TRK_SERIF if k=="serif" else TRK_SANS)*sz) for t,k,sz in lines]
    cw=int(max(widths))+pad*2
    # vertical layout: baselines
    y=pad; baselines=[]
    for i,(t,k,sz) in enumerate(lines):
        asc,desc=font(k,sz).getmetrics()
        y+= asc if i==0 else sz*float(os.environ.get("LINEGAP","0.74"))
        baselines.append(y)
    ch=int(y+lines[-1][2]*0.35+pad)
    units=[]; serif_mask=Image.new("L",(cw,ch),0); serif_box=None
    for li,((t,k,sz),bl,wd) in enumerate(zip(lines,baselines,widths)):
        f=font(k,sz); x0=(cw-wd)/2
        if k=="serif":
            # per-letter units
            x=x0; idx=0
            for ch_ in t:
                adv=f.getlength(ch_)+TRK_SERIF*sz
                if ch_!=" ":
                    m=Image.new("L",(cw,ch),0); ImageDraw.Draw(m).text((x,bl),ch_,font=f,fill=255,anchor="ls")
                    bb=m.getbbox()
                    if bb:
                        bb=(max(0,bb[0]-20),max(0,bb[1]-20),min(cw,bb[2]+20),min(ch,bb[3]+20))
                        sub=m.crop(bb)
                        u=Image.new("RGBA",sub.size,(0,0,0,0))
                        sh=Image.new("RGBA",sub.size,(0,0,0,0)); sh.putalpha(sub.filter(ImageFilter.GaussianBlur(9)).point(lambda v:int(v*0.6)))
                        u.alpha_composite(sh,(0,6))
                        # gold gradient sized over whole line height for consistency
                        g=gold_grad(sub.width, int(sz*1.1)); gl=Image.new("RGBA",sub.size,(0,0,0,0))
                        gl.paste(g,(0, int(bl-sz*0.78)-bb[1]))
                        gl.putalpha(sub); u.alpha_composite(gl)
                        units.append((u,bb[0],bb[1],idx,"serif"))
                        serif_mask.paste(255,(0,0,cw,ch),m) if False else None
                        serif_mask=Image.fromarray(__import__("numpy").maximum(__import__("numpy").array(serif_mask),__import__("numpy").array(m)))
                    idx+=1
                x+=adv
            serif_box=serif_mask.getbbox()
        else:
            x=x0; idx=0
            for w_ in t.split(" "):
                trk=TRK_SANS*sz
                adv=text_width(f,w_,trk)+f.getlength(" ")+trk*2
                m=Image.new("L",(cw,ch),0); draw_tracked(ImageDraw.Draw(m),x,bl,w_,f,trk)
                bb=m.getbbox()
                if bb:
                    bb=(max(0,bb[0]-16),max(0,bb[1]-16),min(cw,bb[2]+16),min(ch,bb[3]+16))
                    sub=m.crop(bb); u=Image.new("RGBA",sub.size,(0,0,0,0))
                    sh=Image.new("RGBA",sub.size,(0,0,0,0)); sh.putalpha(sub.filter(ImageFilter.GaussianBlur(7)).point(lambda v:int(v*0.65)))
                    u.alpha_composite(sh,(0,5))
                    wl=Image.new("RGBA",sub.size,(255,255,255,0)); wl.putalpha(sub); u.alpha_composite(wl)
                    units.append((u,bb[0],bb[1],idx,"sans"))
                idx+=1; x+=adv
    _bc[bi]=(cw,ch,units,serif_mask,serif_box,lines)
    return _bc[bi]
def render_block(bi,t):
    s,e,l1,l2,opt=B[bi]
    cw,ch,units,smask,sbox,lines=build_block(bi)
    img=Image.new("RGBA",(cw,ch),(0,0,0,0))
    dt=t-s
    out=ease_out((e-t)/0.18)  # exit fade
    behind=opt.get("behind")
    for (u,x,y,idx,kind) in units:
        if kind=="serif":
            d0=idx*(0.045 if behind else 0.04); dur=0.42
            p=ease_out((dt-d0)/dur)
            dy=int((1-p)*(34 if behind else 24)); a=p
        else:
            d0=idx*0.075+ (0.0 if lines[0][1]!="serif" else 0.0); dur=0.34
            p=ease_out((dt-d0)/dur); dy=int((1-p)*18); a=p
        # serif line 2 starts after line1 begins: add small offset
        if kind=="serif" and len(lines)==2: 
            p=ease_out((dt-0.12-idx*0.04)/0.42); dy=int((1-p)*24); a=p
        a*=out
        if a<=0: continue
        if a<1:
            uu=u.copy(); uu.putalpha(uu.getchannel("A").point(lambda v:int(v*a)))
        else: uu=u
        img.alpha_composite(uu,(x,y+dy))
    # shimmer across serif text after entry
    if sbox:
        n_letters=sum(1 for u in units if u[4]=="serif")
        t_in=(0.12 if len(lines)==2 else 0)+n_letters*0.04+0.25
        sh_t=(dt-t_in)/0.85
        if 0<sh_t<1:
            band=Image.new("L",(cw,ch),0); d=ImageDraw.Draw(band)
            bw=int(sbox[2]-sbox[0]); cx=sbox[0]+ (sh_t*1.4-0.2)*bw
            w2=max(40,int(bw*0.16))
            for i in range(w2):
                v=int(255*(1-abs(i-w2/2)/(w2/2))**1.5*0.75)
                xx=int(cx-w2/2+i)
                d.line([(xx+ (ch*0.35),0),(xx-(ch*0.35),ch)],fill=v,width=2)
            band=Image.fromarray(__import__("numpy").minimum(__import__("numpy").array(band),__import__("numpy").array(smask)))
            band=band.point(lambda v:int(v*out))
            hi=Image.new("RGBA",(cw,ch),(255,252,235,0)); hi.putalpha(band)
            img.alpha_composite(hi)
    return img
def draw_button(canvas,t):
    s,e=BTN
    if not (s<=t<=e): return
    a=ease_out((t-s)/0.3)*ease_out((e-t)/0.2)
    pulse=1+0.02*math.sin((t-s)*2*math.pi*1.2)
    bw,bh=int(520*pulse),int(112*pulse); cx,cy=540,1500
    layer=Image.new("RGBA",(W,H),(0,0,0,0)); d=ImageDraw.Draw(layer)
    box=(cx-bw//2,cy-bh//2,cx+bw//2,cy+bh//2)
    d.rounded_rectangle(box,radius=bh//2,fill=(10,10,10,150),outline=(222,184,86,255),width=3)
    d.text((cx,cy+2),"QUERO CONSULTAR",font=font("sans",40),fill=(246,226,160,255),anchor="mm")
    ch_y=cy+bh//2+40+int(8*math.sin((t-s)*2*math.pi*1.5))
    d.line([(cx-22,ch_y),(cx,ch_y+16),(cx+22,ch_y)],fill=(222,184,86,255),width=5,joint="curve")
    # entry: scale from 0.9
    sc=0.9+0.1*ease_out((t-s)/0.3)
    if sc<1:
        layer=layer.resize((int(W*sc),int(H*sc)),Image.LANCZOS)
        tmp=Image.new("RGBA",(W,H),(0,0,0,0)); tmp.paste(layer,(int(cx-cx*sc),int(cy-cy*sc))); layer=tmp
    layer.putalpha(layer.getchannel("A").point(lambda v:int(v*a)))
    canvas.alpha_composite(layer)
def main(out="ovl2",start=0,end=N):
    os.makedirs(out,exist_ok=True)
    for n in range(start,end):
        t=n/FPS
        canvas=Image.new("RGBA",(W,H),(0,0,0,0))
        active=[i for i,b in enumerate(B) if b[0]<=t<=b[1]]
        def put(i):
            img=render_block(i,t); cy=B[i][4].get("cy",1250)
            canvas.alpha_composite(img,(540-img.width//2,cy-img.height//2))
        beh=[i for i in active if B[i][4].get("behind")]
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
    a=sys.argv[1:]; main("ovl4",int(a[0]) if a else 0,int(a[1]) if len(a)>1 else N)
