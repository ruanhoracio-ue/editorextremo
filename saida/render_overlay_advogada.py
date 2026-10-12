import json, math, os, sys
from PIL import Image, ImageDraw, ImageFont, ImageFilter
W,H,FPS=1080,1920,30
N=597
FONTS="/tmp/claude-0/-home-user-editorextremo/f24ac11d-f2d9-54d0-9f8e-c6b5f70c16cc/scratchpad/fonts"
INTER="/usr/share/fonts/opentype/inter"
CITY=os.environ.get("CITY","São Ludgero")
_fc={}
def font(kind,size):
    k=(kind,size)
    if k in _fc: return _fc[k]
    if kind=="sans": f=ImageFont.truetype(f"{INTER}/InterDisplay-SemiBold.otf",size)
    elif kind=="sansb": f=ImageFont.truetype(f"{INTER}/InterDisplay-Bold.otf",size)
    else:
        f=ImageFont.truetype(f"{FONTS}/EBGaramond-Italic[wght].ttf",size)
        try: f.set_variation_by_axes([500])
        except Exception: pass
    _fc[k]=f; return f
# styles: (kind,size,color) color 'w' white or 'g' gold
S=lambda t,k,sz: (t,k,sz)
def small(t,sz=48): return [S(t,"sans",sz)]
def bold(t,sz=96): return [S(t,"sansb",sz)]
def gold(t,sz=120): return [S(t,"serif",sz)]
# blocks: start,end,lines,opts
B=[
 (0.34,2.50,[small("já pensou receber",50),gold("a notícia",150)],{}),
 (2.55,4.20,[gold("dinheiro",300)],{"behind":True,"cy":780}),
 (2.55,4.20,[small("que você tem",54),bold("para receber",104)],{"cy":1290}),
 (4.45,5.40,[bold("e não sabe?",120)],{}),
 (5.58,7.20,[small("isso pode acontecer",54),bold("com você,",120)],{}),
 (7.26,9.15,[bold("servidor público",84),gold("de "+CITY,124)],{}),
 (9.26,10.55,[small("esse direito",64),gold("é seu",190)],{}),
 (10.58,11.52,[small("você pode",54),bold("consultá-lo",100)],{}),
 (11.56,12.70,[gold("sem custo",280)],{"behind":True,"cy":780}),
 (11.56,12.70,[bold("nenhum.",120)],{"cy":1290}),
 (12.78,15.15,[bold("clique no botão",92),small("que está aparecendo na sua tela",46)],{"cy":1180}),
 (15.42,16.55,[small("preenche",56),gold("o formulário",130)],{}),
 (16.62,18.35,[small("e nosso time",54),bold("entrará em contato",88)],{}),
 (18.46,19.90,[gold("em breve",170),bold("com você.",100)],{}),
]
BTN=(12.85,15.25)
CUT="cut"
def ease(x): x=max(0,min(1,x)); return 1-(1-x)**3
def gold_fill(mask_img):
    w,h=mask_img.size
    grad=Image.new("RGBA",(w,h))
    px=grad.load()
    stops=[(0,(255,244,196)),(0.35,(232,196,96)),(0.55,(255,236,160)),(0.8,(190,140,40)),(1,(130,92,20))]
    for y in range(h):
        p=y/max(1,h-1)
        for i in range(len(stops)-1):
            a,ca=stops[i]; b,cb=stops[i+1]
            if a<=p<=b:
                q=(p-a)/(b-a); c=tuple(int(ca[j]+(cb[j]-ca[j])*q) for j in range(3)); break
        for x in range(w): px[x,y]=c+(255,)
    grad.putalpha(mask_img)
    return grad
def render_block(lines, alpha=1.0, scale=1.0):
    # measure
    gap=0.08
    metrics=[]
    for ln in lines:
        asc=max(font(k,int(sz*scale)).getmetrics()[0] for _,k,sz in ln)
        desc=max(font(k,int(sz*scale)).getmetrics()[1] for _,k,sz in ln)
        width=sum(font(k,int(sz*scale)).getlength(t) for t,k,sz in ln)
        szmax=max(sz for _,_,sz in ln)*scale
        metrics.append((asc,desc,width,szmax))
    # tight line stacking: use 0.92*size as line advance
    tot=0; adv=[]
    for i,(asc,desc,wd,szm) in enumerate(metrics):
        a=szm*0.95 if i>0 else asc*1.0
        adv.append(a); tot+=a
    tot+=metrics[-1][1]*0.4
    pad=60
    cw=int(max(m[2] for m in metrics))+pad*2; ch=int(tot)+pad*2
    img=Image.new("RGBA",(cw,ch),(0,0,0,0))
    y=pad
    for i,(ln,(asc,desc,wd,szm)) in enumerate(zip(lines,metrics)):
        y+=adv[i]
        x=(cw-wd)/2
        for t,k,sz in ln:
            f=font(k,int(sz*scale))
            if k=="serif":
                m=Image.new("L",(cw,ch),0); ImageDraw.Draw(m).text((x,y),t,font=f,fill=255,anchor="ls")
                sh=Image.new("RGBA",(cw,ch),(0,0,0,0)); sh.putalpha(m.filter(ImageFilter.GaussianBlur(10)).point(lambda v:int(v*0.55)))
                img.alpha_composite(sh,(0,6))
                bbox=m.getbbox()
                if bbox:
                    sub=m.crop(bbox); g=gold_fill(sub); img.alpha_composite(g,(bbox[0],bbox[1]))
            else:
                m=Image.new("L",(cw,ch),0); ImageDraw.Draw(m).text((x,y),t,font=f,fill=255,anchor="ls")
                sh=Image.new("RGBA",(cw,ch),(0,0,0,0)); sh.putalpha(m.filter(ImageFilter.GaussianBlur(8)).point(lambda v:int(v*0.6)))
                img.alpha_composite(sh,(0,5))
                ImageDraw.Draw(img).text((x,y),t,font=f,fill=(255,255,255,255),anchor="ls")
            x+=f.getlength(t)
    if alpha<1:
        a=img.getchannel("A").point(lambda v:int(v*alpha)); img.putalpha(a)
    return img
def draw_button(canvas,t):
    s,e=BTN
    if not (s<=t<=e): return
    a=ease((t-s)/0.25)*ease((e-t)/0.2)
    pulse=1+0.02*math.sin((t-s)*2*math.pi*1.2)
    bw,bh=int(520*pulse),int(112*pulse)
    cx,cy=540,1500
    layer=Image.new("RGBA",(W,H),(0,0,0,0)); d=ImageDraw.Draw(layer)
    box=(cx-bw//2,cy-bh//2,cx+bw//2,cy+bh//2)
    d.rounded_rectangle(box,radius=bh//2,fill=(10,10,10,150),outline=(222,184,86,255),width=3)
    f=font("sans",40)
    d.text((cx,cy+2),"QUERO CONSULTAR",font=f,fill=(246,226,160,255),anchor="mm")
    # chevron
    ch_y=cy+bh//2+40+int(8*math.sin((t-s)*2*math.pi*1.5))
    d.line([(cx-22,ch_y),(cx,ch_y+16),(cx+22,ch_y)],fill=(222,184,86,255),width=5,joint="curve")
    la=layer.getchannel("A").point(lambda v:int(v*a)); layer.putalpha(la)
    canvas.alpha_composite(layer)
_cache={}
def main(out="ovl", start=0, end=N):
    os.makedirs(out,exist_ok=True)
    for n in range(start,end):
        t=n/FPS
        canvas=Image.new("RGBA",(W,H),(0,0,0,0))
        active=[b for b in B if b[0]-0.02<=t<=b[1]]
        def put(s,e,lines,opt):
            fi=ease((t-s)/0.22); fo=ease((e-t)/0.16)
            a=min(fi,fo); sc=0.94+0.06*fi
            img=render_block(lines,1.0,sc)
            if a<1:
                al=img.getchannel("A").point(lambda v:int(v*a)); img.putalpha(al)
            cy=opt.get("cy",1250); dy=int((1-fi)*26)
            canvas.alpha_composite(img,(540-img.width//2,cy-img.height//2+dy))
        behind=[b for b in active if b[3].get("behind")]
        for b in behind: put(*b)
        if behind:
            cf=f"{CUT}/f_{n:04d}.png"
            if os.path.exists(cf): canvas.alpha_composite(Image.open(cf).convert("RGBA"))
        for b in active:
            if not b[3].get("behind"): put(*b)
        draw_button(canvas,t)
        canvas.save(f"{out}/o_{n:04d}.png")
        if n%50==0: print(n,flush=True)
if __name__=="__main__":
    a=sys.argv[1:]
    main("ovl", int(a[0]) if a else 0, int(a[1]) if len(a)>1 else N)
