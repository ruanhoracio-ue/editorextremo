import json, subprocess, numpy as np
from PIL import Image
W4,H4=2160,3840; N=597
pts=json.load(open("track.json")); idx=np.arange(0,N,15)[:len(pts)]
cx=np.interp(np.arange(N),idx,[p[0] for p in pts]); ht=np.interp(np.arange(N),idx,[p[1] for p in pts])
k=np.ones(21)/21; pad=lambda a:np.concatenate([np.full(10,a[0]),a,np.full(10,a[-1])])
cx=np.convolve(pad(cx),k,"valid"); ht=np.convolve(pad(ht),k,"valid")
segs=[(0,1.24),(133,1.45),(167,1.24),(278,1.47),(317,1.26),(383,1.24),(462,1.28),(553,1.45)]
ends=[s[0] for s in segs[1:]]+[N]
z=np.zeros(N)
for (s,z0),e in zip(segs,ends):
    for n in range(s,e): z[n]=z0+0.02*(n-s)/(e-s)
dec=subprocess.Popen(["ffmpeg","-v","error","-ss","0.9","-to","20.8","-i","../bruto/bruto.mov","-vf","fps=30","-f","rawvideo","-pix_fmt","rgb24","-"],stdout=subprocess.PIPE)
enc=subprocess.Popen(["ffmpeg","-y","-v","error","-f","rawvideo","-pix_fmt","rgb24","-s","1080x1920","-r","30","-i","-","-vf","eq=contrast=1.06:saturation=1.05:brightness=-0.01,vignette=angle=PI/5:mode=forward,format=yuv420p","-c:v","libx264","-preset","fast","-crf","16","base6.mp4"],stdin=subprocess.PIPE)
fs=W4*H4*3; n=0; crops=[]
while n<N:
    buf=dec.stdout.read(fs)
    if len(buf)<fs: break
    fr=Image.frombuffer("RGB",(W4,H4),buf,"raw","RGB",0,1)
    w=W4/z[n]; h=H4/z[n]
    x=min(max(cx[n]-w/2,0),W4-w); y=min(max(ht[n]-0.13*h,645),H4-h)
    crops.append((x,y,w,h))
    out=fr.resize((1080,1920),Image.LANCZOS,box=(x,y,x+w,y+h))
    enc.stdin.write(out.tobytes()); n+=1
    if n%100==0: print(n,flush=True)
enc.stdin.close(); enc.wait(); dec.stdout.close()
json.dump(crops,open("crops6.json","w")); print("frames",n)
