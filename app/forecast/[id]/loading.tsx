import { PageLoading } from "@/components/chrome/PageLoading";

export default function Loading() {
  return <PageLoading title="Aftershock forecast" detail="Fetching the USGS forecast, or computing one from the catalogue…" />;
}
