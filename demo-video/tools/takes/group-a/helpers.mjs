export const wrap = (a) => {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
};
/** Turns so the PLAYER faces world point (x, z) (camera yaw from the player's feet). */
export async function faceFrom(page, x, z, { duration = 800, pitch } = {}) {
  const pl = await page.player();
  const pose = await page.pose();
  const yaw = Math.atan2(-(x - pl.x), -(z - pl.z));
  const dp = pitch == null ? 0 : pitch - pose.pitch;
  await page.turn(wrap(yaw - pose.yaw), dp, { duration });
}
