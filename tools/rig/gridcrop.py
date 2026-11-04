from PIL import Image, ImageDraw
import sys
src=sys.argv[1]; out=sys.argv[2]; box=tuple(map(int,sys.argv[3].split(','))); s=float(sys.argv[4]); g=int(sys.argv[5])
im=Image.open(src).convert('RGB')
c=im.crop(box).resize((int((box[2]-box[0])*s),int((box[3]-box[1])*s)),Image.LANCZOS); d=ImageDraw.Draw(c)
for x in range((box[0]//g)*g,box[2],g):
    if x<box[0]: continue
    X=(x-box[0])*s; d.line([(X,0),(X,c.height)],fill=(255,0,0) if x%(g*5)==0 else (255,255,255),width=1); d.text((X+2,2),str(x),fill=(255,255,0))
for y in range((box[1]//g)*g,box[3],g):
    if y<box[1]: continue
    Y=(y-box[1])*s; d.line([(0,Y),(c.width,Y)],fill=(255,0,0) if y%(g*5)==0 else (255,255,255),width=1); d.text((2,Y+2),str(y),fill=(255,255,0))
c.save(out)
