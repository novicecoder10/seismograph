import { createWikimediaPhotoRepository } from "@/lib/repositories/photos";
import { PhotoGallery } from "./PhotoGallery";

const photos = createWikimediaPhotoRepository();

/** Streams in after the page: Wikidata takes a second or two cold, and most
 *  earthquakes have no photographs, in which case nothing is rendered. */
export async function EventPhotos({ lat, lon, timeMs }: { lat: number; lon: number; timeMs: number }) {
  const data = await photos.forEvent(lat, lon, timeMs);
  return data === null ? null : <PhotoGallery data={data} />;
}
