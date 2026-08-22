from PIL import Image
import colorsys

img = Image.open(r"C:\Users\simip\Projects\austin-3d-explorer\.claude\worktrees\wf_540ab009-56c-2\shots\q\towerglow\before-tower-close-night.png")
w, h = img.size
print("size", w, h)

# The shaft in before-tower-close-night.png runs roughly x=630-690, y=210-370
# (eyeballed from the viewed image). Sample a vertical strip down the middle
# of the north face, away from window slots (x offset avoiding the dark columns).
x = 640
for y in range(210, 375, 8):
    r, g, b = img.getpixel((x, y))[:3]
    h_, s_, v_ = colorsys.rgb_to_hsv(r/255, g/255, b/255)
    print(f"y={y:4d}  rgb=({r:3d},{g:3d},{b:3d})  hue={h_*360:5.1f}deg  val={v_:.2f}")
