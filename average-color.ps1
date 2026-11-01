# Full-resolution arithmetic RGB mean, after compositing transparency on the matte.
Add-Type -AssemblyName System.Drawing
if (-not ('GalleryPixelAverage' -as [type])) {
  Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
public static class GalleryPixelAverage {
  public static string Compute(Image image, Color matte) {
    using (var bitmap = new Bitmap(image.Width, image.Height, PixelFormat.Format24bppRgb)) {
      using (var graphics = Graphics.FromImage(bitmap)) {
        graphics.Clear(matte);
        graphics.DrawImage(image, new Rectangle(0, 0, image.Width, image.Height),
          0, 0, image.Width, image.Height, GraphicsUnit.Pixel);
      }
      var data = bitmap.LockBits(new Rectangle(0, 0, bitmap.Width, bitmap.Height),
        ImageLockMode.ReadOnly, PixelFormat.Format24bppRgb);
      long red = 0, green = 0, blue = 0, count = (long)bitmap.Width * bitmap.Height;
      try {
        var row = new byte[checked(bitmap.Width * 3)];
        for (int y = 0; y < bitmap.Height; y++) {
          Marshal.Copy(IntPtr.Add(data.Scan0, checked(y * data.Stride)), row, 0, row.Length);
          for (int x = 0; x < row.Length; x += 3) {
            blue += row[x]; green += row[x + 1]; red += row[x + 2];
          }
        }
      } finally { bitmap.UnlockBits(data); }
      return String.Format("#{0:X2}{1:X2}{2:X2}",
        (red + count / 2) / count, (green + count / 2) / count, (blue + count / 2) / count);
    }
  }
}
'@
}
