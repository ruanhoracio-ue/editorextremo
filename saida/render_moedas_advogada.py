import os, sys, math, random
os.environ["OUT"]="ovl8"
import render_v7 as R
from PIL import Image, ImageDraw, ImageFont, ImageFilter
W,H,FPS=R.W,R.H,R.FPS
# ---- coin sprite ----
def coin_sprite(d=150):
    s=4; D=d*s; im=Image.new("RGBA",(D,D),(0,0,0,0)); dr=ImageDraw.Draw(im)
    # radial-ish gradient via concentric circles
    for i in range(D//2,0,-1):
        p=i/(D/2); c=(int(255-60*p),int(225-85*p),int(120-70*p))
        dr.ellipse((D/2-i,D/2-i,D/2+i,D/2+i),fill=c+(255,))
    dr.ellipse((D*0.04,D*0.04,D*0.96,D*0.96),outline=(140,98,24,255),width=int(D*0.035))
    dr.ellipse((D*0.16,D*0.16,D*0.84,D*0.84),outline=(255,240,190,200),width=int(D*0.02))
    f=ImageFont.truetype(f"{R.FONTS}/Cormorant-Italic.ttf",int(D*0.5))
    try: f.set_variation_by_axes([700])
    except Exception: pass
    dr.text((D/2+D*0.01,D/2+D*0.03),"$",font=f,fill=(130,90,20,255),anchor="mm")
    dr.text((D/2-D*0.01,D/2+D*0.01),"$",font=f,fill=(255,236,170,255),anchor="mm")
    # highlight
    hl=Image.new("RGBA",(D,D),(0,0,0,0)); ImageDraw.Draw(hl).ellipse((D*0.18,D*0.1,D*0.6,D*0.42),fill=(255,255,255,110))
    hl=hl.filter(ImageFilter.GaussianBlur(D*0.05)); im.alpha_composite(hl)
    return im.resize((d,d),Image.LANCZOS)
COIN=coin_sprite(150)
def sparkle(sz):
    im=Image.new("RGBA",(sz,sz),(0,0,0,0)); d=ImageDraw.Draw(im); c=sz/2
    d.line([(c,0),(c,sz)],fill=(255,245,200,255),width=max(2,sz//14)); d.line([(0,c),(sz,c)],fill=(255,245,200,255),width=max(2,sz//14))
    d.line([(c*0.35,c*0.35),(c*1.65,c*1.65)],fill=(255,245,200,160),width=max(1,sz//22)); d.line([(c*1.65,c*0.35),(c*0.35,c*1.65)],fill=(255,245,200,160),width=max(1,sz//22))
    return im.filter(ImageFilter.GaussianBlur(sz*0.03))
SPK=[sparkle(s) for s in (28,40,56)]
rng=random.Random(42)
T_START=2.45; T_END=4.35   # "dinheiro" block window (trimmed time)
coins=[]
for i in range(30):
    coins.append(dict(x=rng.uniform(40,1040), t0=T_START+rng.uniform(0,0.9), v=rng.uniform(520,820), size=rng.uniform(0.42,0.82),
                      spin=rng.uniform(1.2,2.6), ph=rng.uniform(0,6.28), y0=rng.uniform(-260,-60), drift=rng.uniform(-60,60)))
sparks=[dict(x=rng.uniform(60,1020),y=rng.uniform(80,900),t0=T_START+rng.uniform(0.1,1.5),k=rng.randrange(3)) for _ in range(18)]
def ease_out(x): x=max(0.0,min(1.0,x)); return 1-(1-x)**3
def coins_layer(t):
    layer=Image.new("RGBA",(W,H),(0,0,0,0))
    if not (T_START<=t<=T_END): return None
    fade=min(ease_out((t-T_START)/0.25), ease_out((T_END-t)/0.35))
    for c in coins:
        dt=t-c["t0"]
        if dt<0: continue
        y=c["y0"]+c["v"]*dt+0.5*300*dt*dt; x=c["x"]+c["drift"]*dt+18*math.sin(dt*3+c["ph"])
        if y>H+100: continue
        d=int(150*c["size"]); sq=abs(math.cos(dt*c["spin"]*2+c["ph"]))
        w=max(4,int(d*(0.15+0.85*sq)))
        sp=COIN.resize((w,d),Image.LANCZOS)
        if sq<0.35: # edge-on: darker rim look
            sp=Image.composite(Image.new("RGBA",sp.size,(170,125,40,255)),sp,sp.getchannel("A").point(lambda v:int(v*0.6)))
        a=fade*(0.95 if c["size"]>0.75 else 0.75)
        sp.putalpha(sp.getchannel("A").point(lambda v:int(v*a)))
        if c["size"]<0.7: sp=sp.filter(ImageFilter.GaussianBlur(1.2))
        layer.alpha_composite(sp,(int(x-w/2),int(y-d/2)))
    for s in sparks:
        dt=t-s["t0"]
        if 0<=dt<0.5:
            p=math.sin(math.pi*dt/0.5); im=SPK[s["k"]]; sc=0.5+0.6*p
            im2=im.resize((max(2,int(im.width*sc)),)*2,Image.BILINEAR); im2.putalpha(im2.getchannel("A").point(lambda v:int(v*p*fade)))
            layer.alpha_composite(im2,(int(s["x"]-im2.width/2),int(s["y"]-im2.height/2)))
    return layer
def main(start,end):
    os.makedirs("ovl8",exist_ok=True)
    for n in range(start,end):
        t=n/FPS
        canvas=Image.new("RGBA",(W,H),(0,0,0,0))
        active=[i for i,b in enumerate(R.B) if b[0]<=t<=b[1]]
        def put(i):
            img=R.render_block(i,t); cy=R.B[i][3].get("cy",1250)
            canvas.alpha_composite(img,(540-img.width//2,cy-img.height//2))
        beh=[i for i in active if R.B[i][3].get("behind")]
        cl=coins_layer(t)
        if cl is not None: canvas.alpha_composite(cl)
        for i in beh: put(i)
        if beh or cl is not None:
            cf=f"{R.CUT}/f_{n:04d}.png"
            if os.path.exists(cf): canvas.alpha_composite(Image.open(cf).convert("RGBA"))
        for i in active:
            if i not in beh: put(i)
        R.draw_button(canvas,t)
        canvas.save(f"ovl8/o_{n:04d}.png")
if __name__=="__main__":
    a=sys.argv[1:]; main(int(a[0]),int(a[1]))
