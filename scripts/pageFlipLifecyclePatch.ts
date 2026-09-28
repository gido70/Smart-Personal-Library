/** page-flip 2.0.7 leaves its animation-frame loop running after destroy().
 * Narrow build-time patch, checked against pinned upstream source. No global
 * browser APIs are replaced. Fail the build if a dependency upgrade changes it. */
export function patchPageFlipLifecycle(source: string): string {
  const oldStart = 'start(){this.update();const t=e=>{this.render(e),requestAnimationFrame(t)};requestAnimationFrame(t)}';
  const oldDestroy = 'destroy(){this.ui.destroy(),this.block.remove()}';
  const oldCorners = 'return n.x>0&&n.y>0&&n.x<e.width&&n.y<e.height&&(n.x<s||n.x>e.width-s)&&(n.y<s||n.y>e.height-s)';
  if (source.split(oldCorners).length !== 2) throw new Error('Review page-flip portrait corner patch after dependency upgrade');
  if (source.split(oldStart).length !== 2 || source.split(oldDestroy).length !== 2) {
    throw new Error('Review page-flip lifecycle patch after dependency upgrade');
  }
  return source.replace(oldStart, 'start(){this.update();this.splStopped=false;const t=e=>{if(this.splStopped)return;this.render(e);this.splFrame=requestAnimationFrame(t)};this.splFrame=requestAnimationFrame(t)}stop(){this.splStopped=true;cancelAnimationFrame(this.splFrame)}')
    .replace(oldDestroy, 'destroy(){this.render.stop(),this.ui.destroy(),this.block.remove()}')
    // In portrait, the physical left sheet is hidden; the visible left edge is
    // at pageWidth in book coordinates. Otherwise flipPrev silently does nothing.
    .replace(oldCorners, 'const h="portrait"===this.render.getOrientation()?i:0;return n.x>h&&n.y>0&&n.x<e.width&&n.y<e.height&&(n.x<h+s||n.x>e.width-s)&&(n.y<s||n.y>e.height-s)');
}
