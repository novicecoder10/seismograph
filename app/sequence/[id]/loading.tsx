import { PageLoading } from "@/components/chrome/PageLoading";

export default function Loading() {
  return <PageLoading title="Aftershock sequence" detail="Fetching the local catalogue and fitting completeness, b-value, Omori and ETAS…" />;
}
