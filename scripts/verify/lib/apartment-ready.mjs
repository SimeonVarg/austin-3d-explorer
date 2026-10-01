export async function waitForApartmentBuild(page) {
 await page.waitForFunction(()=>window.slopesApartments?.group&&window.slopesApartments.count.ms>0&&window.slopesApartments.readyToReveal(),null,{timeout:180000});
}
