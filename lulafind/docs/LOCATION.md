# Location and local feed

New accounts see a consent dialog during onboarding. If the member agrees, the
app requests a one-off device fix and sends it to a Nominatim-compatible reverse
geocoder using OpenStreetMap data. The returned South African province and
optional town are saved to the profile at the end of onboarding; the precise
coordinates from this lookup are not persisted for the feed. The person can
skip it and set an area manually in Profile later. No province is invented or required. The normal
profile visibility settings still apply.

The For you feed ranks exact town matches in the same province first, followed
by the rest of the province, preserving the prior order within each group and
keeping all other visible posts. This only sorts the posts the active backend
returned; for example the Supabase feed currently fetches at most the newest
300 records. It does not change backend visibility checks, Network, other
screens or notifications.

`OPENSTREETMAP_REVERSE_URL` in `src/app/core/config.ts` selects the reverse
endpoint. It defaults to the public Nominatim service for low-volume testing,
not a guaranteed production service. Before launch, review the
[Nominatim usage policy](https://operations.osmfoundation.org/policies/nominatim/),
including its application-wide rate limit, identification, attribution and
switching requirements. For production traffic, choose an appropriately
provisioned Nominatim-compatible provider or self-host, update the endpoint and
verify CORS/native access, service terms and the location disclosure. Do not
embed a secret in the client. If the lookup fails, onboarding keeps the manual
option. Map data attribution appears in the UI.
