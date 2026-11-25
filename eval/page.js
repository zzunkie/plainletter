// Renders a notice as a photo-like JPEG: tilt, shear, blur, shadow, sensor noise, JPEG compression.
window.rng = (seed) => () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
window.renderPhoto = async (n, idx) => {
  const r = rng(idx * 7919 + 13);
  const doc = document.createElement('canvas'); doc.width = 1100; doc.height = 720;
  const x = doc.getContext('2d');
  x.fillStyle = '#fbfaf6'; x.fillRect(0, 0, 1100, 720);
  x.fillStyle = '#1a1a1a'; x.font = 'bold 30px ' + n.font; x.fillText(n.title, 50, 70);
  x.fillRect(50, 88, 1000, 2);
  x.font = '24px ' + n.font; n.lines.forEach((t, i) => x.fillText(t, 50, 150 + i * 56));
  const out = document.createElement('canvas'); out.width = 1280; out.height = 960;
  const o = out.getContext('2d');
  o.fillStyle = '#6b5a48'; o.fillRect(0, 0, 1280, 960);
  const ang = (r() * 8 - 4) * Math.PI / 180, shear = r() * 0.08 - 0.04, blur = 0.5 + r() * 0.9;
  o.save(); o.translate(640, 480); o.rotate(ang); o.transform(1, 0, shear, 1, 0, 0);
  o.filter = `blur(${blur.toFixed(2)}px)`; o.drawImage(doc, -550, -360); o.restore(); o.filter = 'none';
  const g = o.createLinearGradient(r() * 400, 0, 900 + r() * 380, 960);
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, `rgba(0,0,0,${(0.2 + r() * 0.25).toFixed(2)})`);
  o.fillStyle = g; o.fillRect(0, 0, 1280, 960);
  const img = o.getImageData(0, 0, 1280, 960), d = img.data;
  for (let i = 0; i < d.length; i += 4) { const k = (r() - 0.5) * 22; d[i] += k; d[i + 1] += k; d[i + 2] += k; }
  o.putImageData(img, 0, 0);
  const blob = await new Promise(res => out.toBlob(res, 'image/jpeg', 0.6));
  const bmp = await createImageBitmap(blob);
  const dataUrl = await new Promise(res => { const f = new FileReader(); f.onload = () => res(f.result); f.readAsDataURL(blob); });
  return { bmp, dataUrl, params: { deg: +(ang * 180 / Math.PI).toFixed(1), shear: +shear.toFixed(3), blur: +blur.toFixed(2) } };
};
// Same treatment for a document page that was rendered to an image (eval/docs/*.html).
window.photoFrom = async (src, idx) => {
  const page = await createImageBitmap(await (await fetch(src)).blob());
  const r = rng(idx * 7919 + 13);
  const W = page.width + 200, H = page.height + 200;
  const out = document.createElement('canvas'); out.width = W; out.height = H;
  const o = out.getContext('2d');
  o.fillStyle = '#6b5a48'; o.fillRect(0, 0, W, H);
  const ang = (r() * 5 - 2.5) * Math.PI / 180, shear = r() * 0.05 - 0.025, blur = 0.4 + r() * 0.7;
  o.save(); o.translate(W / 2, H / 2); o.rotate(ang); o.transform(1, 0, shear, 1, 0, 0);
  o.filter = `blur(${blur.toFixed(2)}px)`; o.drawImage(page, -page.width / 2, -page.height / 2); o.restore(); o.filter = 'none';
  const g = o.createLinearGradient(r() * 400, 0, W - r() * 300, H);
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, `rgba(0,0,0,${(0.15 + r() * 0.22).toFixed(2)})`);
  o.fillStyle = g; o.fillRect(0, 0, W, H);
  const img = o.getImageData(0, 0, W, H), d = img.data;
  for (let i = 0; i < d.length; i += 4) { const k = (r() - 0.5) * 20; d[i] += k; d[i + 1] += k; d[i + 2] += k; }
  o.putImageData(img, 0, 0);
  const blob = await new Promise((res) => out.toBlob(res, 'image/jpeg', 0.7));
  const dataUrl = await new Promise((res) => { const f = new FileReader(); f.onload = () => res(f.result); f.readAsDataURL(blob); });
  return { dataUrl, params: { deg: +(ang * 180 / Math.PI).toFixed(1), shear: +shear.toFixed(3), blur: +blur.toFixed(2) } };
};
