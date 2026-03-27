import Link from "next/link";
import Image from "next/image";

import forms from "@/styles/forms.module.css";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { resolveFotTokenHash } from "@/lib/fot/tokens";
import styles from "./page.module.css";

type FotLocationRow = Record<string, unknown>;

type SiteCard = {
  id: string;
  name: string;
  imageSrc: string;
  locationId: number | null;
  siteKey: SiteKey | null;
};

type PageSearchParams = Promise<{
  t?: string;
}>;

type MemberNameRow = {
  fname: string | null;
};

type MemberEligibilityRow = {
  id: number;
  statusid: number | null;
  baptized: boolean | null;
};

type FotRegRow = {
  locationid: number | string | null;
  datecreated: string | null;
};

type FotLocationNameRow = {
  name: string | null;
};

type SiteKey = "us" | "au" | "ca" | "nl";

const FOT_YEAR = new Date().getFullYear();

const FALLBACK_IMAGES = ["/window.svg", "/globe.svg", "/file.svg", "/next.svg"];
const MANUAL_IMAGE_BY_LOCATION_ID: Record<number, string> = {
  1: "/fot/locations/us.jpg",
  2: "/fot/locations/nl.jpg",
  3: "/fot/locations/au.jpg",
  4: "/fot/locations/ca.jpg",
};
export const dynamic = "force-dynamic";

function toText(value: unknown) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function toId(value: unknown) {
  const id = toText(value);
  return id.length ? id : "";
}

function firstNonEmpty(row: FotLocationRow, keys: string[]) {
  for (const key of keys) {
    const value = toText(row[key]);
    if (value) return value;
  }
  return "";
}

function asBool(value: unknown) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  const text = toText(value).toLowerCase();
  if (!text) return false;
  return ["1", "true", "yes", "y", "active"].includes(text);
}

function toSiteCard(row: FotLocationRow, index: number): SiteCard | null {
  const id = toId(row.id ?? row.locationid ?? row.code ?? row.slug);
  if (!id) return null;
  const numericId = /^\d+$/.test(id) ? Number(id) : null;

  const rawName = firstNonEmpty(row, ["name", "title", "locationname"]) || `Site ${index + 1}`;
  const normalizedName =
    rawName.trim().toLowerCase() === "no attending any site"
      ? "Not attending any site"
      : rawName;

  const siteKey = inferSiteKey(normalizedName);
  const manualImage = numericId
    ? (MANUAL_IMAGE_BY_LOCATION_ID[numericId] ?? "")
    : "";
  const imageSrc =
    manualImage || FALLBACK_IMAGES[index % FALLBACK_IMAGES.length];

  return {
    id,
    name: normalizedName,
    locationId: numericId,
    imageSrc,
    siteKey,
  };
}

function renderHardcodedLocationContent(site: SiteCard) {
  if (site.locationId === 1) {
    return (
      <>
        <p>
          <strong>Courtyard by Marriott</strong>
          <br />
          120 Community Center Drive
          <br />
          Pigeon Forge, TN{" "}
        </p>
        <br />
        <p>
          All services for all sites begin at 10 am each day of the Feast. The
          first day of the Feast also has an afternoon meeting that is at 2:30
          pm [14:30]. There is no organized meal planned for the first day
          between services. Everyone is on their own for that noon meal.
        </p>
        <p>
          Please note that using this booking link, all nights will
          automatically default to $269.00 plus tax per night, however, the{" "}
          <strong>
            hotel will manually adjust rates to the group contracted rates as
            follows
          </strong>
          :
        </p>
        <p>
          9/25/26 - 9/26/26:$219.00 plus tax per night per room
          <br />
          9/27/26-10/1/26: $154.00 plus tax per night per room
          <br />
          10/2/26-10/3/26: $269.00 plus tax per night per room
        </p>
        <p>
          Please do not contact the hotel regarding the rate change as this will
          be updated per the contract if you book through this link under the
          group code. Should you need{" "}
          <strong>
            handicap accessible accommodations, please book your room and call
            the hotel immediately to confirm if an accessible room is available.
          </strong>
        </p>
        <p>
          <strong>Individual cancellation policy:</strong> 1 night&apos;s room &
          tax will be charged to the credit card on file for cancellations
          received within 14 days of arrival.
        </p>

        <p>
          <strong>Booking link:</strong>{" "}
          <a
            href="https://app.marriott.com/reslink?id=1768596286719&key=GRP&app=resvlink"
            target="_blank"
          >
            Book your group rate for The Church of God - PKG
          </a>
        </p>
      </>
    );
  }

  if (site.locationId === 2) {
    return (
      <>
        <p>
          The Feast in the Netherlands will be held at the{" "}
          <strong>Inntel Hotel in Zaandam</strong>. Services will begin each day
          at 10:00 a.m. On the first day, a catered lunch will be provided
          between the two services.
        </p>
        <p>
          The hotel is conveniently located next to the Zaandam train
          station—about a 2-minute walk. There is a{" "}
          <strong>direct train from Schiphol Airport to Zaandam Station</strong>{" "}
          (approximately 20 minutes), as well as a direct train to Amsterdam
          Central Station (about 12 minutes).
        </p>
        <p>
          Parking is available at the{" "}
          <strong>adjacent Q-Park Hermitage parking garage</strong>. The
          discounted rate is €16.00 per vehicle per 24 hours. To receive this
          rate, you must make a reservation using the following link:{" "}
          <a
            href="https://www.q-park.nl/en-gb/parking/zaandam/inntel-hotels-amsterdam-zaandam/"
            target="_blank"
          >
            Q-Park reservation through Inntel Hotel
          </a>
        </p>
        <p>
          To reserve a room at the group’s discounted rate, please use the
          booking link provided below. There are three room types available. If
          you would like to upgrade to a Factory Design Room or a Junior Suite
          (for an additional charge), please email Audra at{" "}
          <a href="mailto:audra.weinland@gmail.com">audra.weinland@gmail.com</a>{" "}
          for instructions.
        </p>
        <p>
          Room rates include breakfast and VAT but exclude city taxes. Please
          note that the initial price shown is based on single occupancy. If two
          people will be staying in the room, be sure to adjust the reservation
          accordingly. The total price will increase to include the additional
          breakfast.
        </p>

        <p>
          <strong>
            Booking link:{" "}
            <a
              href="https://reservations.inntelhotels.nl/?adult=1&arrive=2026-09-25&chain=10315&child=0&currency=EUR&depart=2026-10-04&group=COG260926&hotel=27401&level=hotel&locale=en-US&productcurrency=EUR&rooms=1"
              target="_blank"
            >
              Inntel booking link - CoG discount
            </a>
          </strong>
        </p>
      </>
    );
  }

  if (site.locationId === 3) {
    return (
      <>
        <br />
        <p>
          The Australian and New Zealand feast site for 2026 will be in{" "}
          <strong>OAKS Gold Coast Hotel</strong>, Surfers Paradise QLD 4217.
        </p>

        <p>
          Feast site is:{" "}
          <strong>OAKS Gold Coast Hotel in the &quot;Acacia room&quot;</strong>
        </p>
        <p>
          When you’re ready for a Gold Coast feast where you can take a stroll
          along the beach or shop at Broadbeach or Pacific Fair, the perfect
          place to call your home during the feast is the Gold coast. The feast
          site is only steps away from spectacular surf beaches, casinos and
          Cavill Avenue, to which you can walk or take a tram, which also stops
          near the feast site hotel.
        </p>
        <p>
          Feel like being a little more adventurous? Jump in the car and head to
          the world-famous theme parks or visit the beautiful Gold Coast
          Hinterland for a hike.
        </p>
        <p>
          It is up to each person to arrange their own accommodation and
          transport. There are many types of accomodation that are all within
          walking distance of the Oaks Gold Coast Hotel. You can also look at
          the Crowne Plaza, airbnb.com.au or booking.com. It is the school
          holidays for all states, therefore many of the hotels could already be
          booked out.
        </p>
        <p>
          <strong>Feast Hotel details:</strong>
          <br />
          Address: 2801 Gold Coast Highway, Surfers Paradise 4217
          <br />
          Oaks Hotel Reservations: 1300 991 252
          <br />
          Reception: 07 5648 3100
          <br />
          Reception Hours: 7:00am to 12:00am
          <br />
          Email: 
          <a href="mailto:GoldCoast@theoaksgroup.com.au">
            GoldCoast@theoaksgroup.com.au
          </a>
          <br />
          Website:{" "}
          <a href="https://www.oakshotels.com/en" target="_blank">
            oakshotels.com
          </a>
        </p>
        <p>
          If wanting to stay at the feast site hotel{" "}
          <strong>use the following CODE: “OUREVENT”</strong>. On the Oaks
          Website, there is a position to add in a promo code – if you add in
          “OUREVENT” you will receive 12% for advanced purchase.
        </p>
        <p>
          Upfront charge ON BOOKING.
          <br />
          Non-refundable.
          <br />
          Subject to Availability.
          <br />
          No guarantee rates will stay the same.
          <br />
          There is an FAQ at the bottom of the hotel website which will answer
          many of your questions.
        </p>
        <br />

        <p>
          <strong>Feast meetings Schedule</strong>
        </p>
        <p>
          The Feast meetings will be held in the “Acacia room” on the 2nd floor
          (“accessed by the lift”).
          <br />
          The feast is from Saturday the 26th September 2026 to Saturday the 3rd
          October 2026.
        </p>
        <p>
          26th September 10am and 2.30pm (1st Day feast)
          <br />
          27th September 10am
          <br />
          28th September 10am
          <br />
          29th September 10am
          <br />
          30th September 10am
          <br />
          1st October 10am
          <br />
          2nd October 10am
          <br />
          3rd October 10am (LGD)
        </p>

        <p>
          There are <strong>no church organised meals</strong> on the Holy days.
        </p>
        <br />
        <p>
          <strong>Pet Policy</strong>
          <br />
          No pets allowed. Guide Dogs accepted.
        </p>
        <br />
        <p>
          <strong>Parking Information</strong>
          <br />
          Hotel Guests can park under the hotel for $20 per day (no parking
          reservations available - first in).
          <br />
          There may be some street parking which may be meter parking or other
          parking areas near by. It is School holiday time (2 weeks) in all
          states so car parking may be limited.
          <br />
          The Gold Coast Airport (Coolangatta) is just 30 - 40 minutes’ easy
          drive. A Taxi will cost between $80au to $100au to get to the Oaks
          Hotel. There is <strong>no direct train</strong> from Brisbane to the
          Gold Coast. The train stops at Nerang and a bus or taxi ride is
          needed.
        </p>
        <br />
        <p>
          <strong>Accommodation</strong>
          <br />
          There are many accomodation option’s including “Apartments” on the
          internet in the Gold Coast / Broadbeach area.
          <br />
          Booking.com has a map that shows all the accommodation options close
          to the feast site. Just type in “Broadbeach accommodation”.
          <br />
          Some places may desire a deposit, while others may not.
        </p>
      </>
    );
  }

  if (site.locationId === 4) {
    return (
      <>
        <p>
          <strong>
            Holiday Inn Express OR the Staybridge Niagara-on-the-Lake
          </strong>
          <br />
          524 York Rd.
          <br />
          Niagara-on-the-Lake, Ontario L0S 1J0
        </p>
        <br />
        <p>
          All services for all sites begin at 10 am each day of the Feast. The
          first day of the Feast also has an afternoon meeting that is at 2:30
          pm [14:30]. There is no organized meal planned for the first day
          between services. Everyone is on their own for that noon meal.
        </p>
        <p>
          The meeting room [Inspire East & West Room] is located between the two
          hotels.
        </p>
        <p>
          Booking at the <strong>Staybridge Suites</strong>:
        </p>
        <p>
          You can make your reservations by calling 1-800-465-4329 and
          referencing the group code &quot;COS&quot;, or by using the online link below.
          Once you click the link, you will simply need to hit “Select” and
          enter their information — the rates and dates will populate
          automatically. At this step guests can change their dates if needed.
        </p>
        <p>
          <a
            href="https://www.ihg.com/staybridge/hotels/us/en/find-hotels/select-roomrate?fromRedirect=true&qSrt=sBR&qIta=99801505&icdv=99801505&qSlH=XLVNF&qCiD=26&qCiMy=082026&qCoD=04&qCoMy=092026&qGrpCd=COS&qAAR=6CBARC&qRtP=6CBARC&setPMCookies=true&qSHBrC=SB&qDest=524%20York%20Road,%20Niagara-On-The-Lake,%20ON,%20CA&showApp=true&adjustMonth=false&srb_u=1&qRmFltr="
            target="_blank"
          >
            Staybridge Suites Booking link
          </a>
        </p>
        <br />
        <p>
          Booking at the <strong>Holiday Inn Express</strong>:
        </p>
        <p>
          You can make your reservations by calling 1-800-465-4329 and
          referencing the group code &quot;COH&quot;, or by using the online link below.
          Once you click the link, you will simply need to hit “Select” and
          enter your information — the rates and dates will populate
          automatically. At this step you can change your dates if needed.
        </p>
        <p>
          <a
            href="https://www.ihg.com/redirect?path=rates&brandCode=EX&localeCode=en&regionCode=1&hotelCode=XLVNL&checkInDate=26&checkInMonthYear=082026&checkOutDate=04&checkOutMonthYear=092026&_PMID=99801505&GPC=COH&cn=no&adjustMonth=false&showApp=true&monthIndex=00"
            target="_blank"
          >
            Holiday Inn Express Booking link
          </a>
        </p>
      </>
    );
  }

  return (
    <p>
      Update this location&apos;s yearly details in{" "}
      <code>renderHardcodedLocationContent</code> for location id{" "}
      <strong>{site.id}</strong>.
    </p>
  );
}

function isExternalImage(src: string) {
  return /^https?:\/\//i.test(src);
}

const passthroughLoader = ({
  src,
}: {
  src: string;
  width: number;
  quality?: number;
}) => src;

function inCurrentYear(row: FotLocationRow) {
  const yearRaw = firstNonEmpty(row, [
    "year",
    "fotyear",
    "seasonyear",
    "eventyear",
  ]);
  if (!yearRaw) return true;
  const year = Number(yearRaw);
  if (!Number.isFinite(year)) return true;
  return year === FOT_YEAR;
}

function isActive(row: FotLocationRow) {
  const hasActiveFlag = ["isactive", "active", "enabled"].some(
    (key) => key in row,
  );
  if (!hasActiveFlag) return true;
  return asBool(row.isactive ?? row.active ?? row.enabled);
}

function inferSiteKey(name: string): SiteKey | null {
  const n = name.toLowerCase();
  if (n.includes("tennessee") || n.includes("pigeon forge")) return "us";
  if (n.includes("australia") || n.includes("surfers")) return "au";
  if (n.includes("canada") || n.includes("niagara")) return "ca";
  if (n.includes("netherlands") || n.includes("zaandam")) return "nl";
  return null;
}

async function loadSiteCards() {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase.from("fotlocation").select("*");
  if (error) {
    return {
      cards: [] as SiteCard[],
      error: `Failed to load FoT sites: ${error.message}`,
    };
  }

  const rows = (data ?? []) as FotLocationRow[];
  const rank: Record<SiteKey, number> = {
    us: 0,
    au: 1,
    ca: 2,
    nl: 3,
  };

  const cards = rows
    .filter((row) => inCurrentYear(row) && isActive(row))
    .map((row, index) => toSiteCard(row, index))
    .filter((row): row is SiteCard => Boolean(row))
    .filter((row) => row.siteKey !== null)
    .sort((a, b) => {
      const aRank = a.siteKey ? rank[a.siteKey] : 999;
      const bRank = b.siteKey ? rank[b.siteKey] : 999;
      if (aRank !== bRank) return aRank - bRank;
      return a.name.localeCompare(b.name);
    });

  return { cards, error: "" };
}

async function loadMemberContext(memberId: number | null) {
  if (!memberId) {
    return { firstName: "", registeredLocationName: "", error: "" };
  }

  const supabase = createServiceRoleClient();
  const [
    { data: memberData, error: memberErr },
    { data: regData, error: regErr },
  ] = await Promise.all([
    supabase.from("emcmember").select("fname").eq("id", memberId).limit(1),
    supabase
      .from("fotreg")
      .select("locationid,datecreated")
      .eq("memberid", memberId)
      .order("datecreated", { ascending: false })
      .limit(1),
  ]);

  if (memberErr) {
    return {
      firstName: "",
      registeredLocationName: "",
      error: `Failed to load member details: ${memberErr.message}`,
    };
  }
  if (regErr) {
    return {
      firstName: toText(((memberData ?? []) as MemberNameRow[])[0]?.fname),
      registeredLocationName: "",
      error: `Failed to load registration status: ${regErr.message}`,
    };
  }

  const firstName = toText(((memberData ?? []) as MemberNameRow[])[0]?.fname);
  const latestReg = (((regData ?? []) as FotRegRow[])[0] ??
    null) as FotRegRow | null;
  const locationId = latestReg ? toId(latestReg.locationid) : "";
  if (!locationId) {
    return { firstName, registeredLocationName: "", error: "" };
  }

  const { data: locationData, error: locationErr } = await supabase
    .from("fotlocation")
    .select("name")
    .eq("id", /^\d+$/.test(locationId) ? Number(locationId) : locationId)
    .limit(1);

  if (locationErr) {
    return {
      firstName,
      registeredLocationName: "",
      error: `Failed to load registered site name: ${locationErr.message}`,
    };
  }

  const registeredLocationName =
    toText(((locationData ?? []) as FotLocationNameRow[])[0]?.name) ||
    "your selected site";
  return { firstName, registeredLocationName, error: "" };
}

async function resolveMemberIdFromToken(rawToken: string) {
  const token = rawToken.trim();
  if (!token) return { memberId: null as number | null, error: "Missing registration token." };

  const supabase = createServiceRoleClient();
  const tokenHash = resolveFotTokenHash(token);
  const { data: tokenRows, error: tokenErr } = await supabase
    .from("fotregtoken")
    .select("memberid,isactive")
    .eq("tokenhash", tokenHash)
    .eq("isactive", true)
    .limit(1);
  if (tokenErr) {
    return { memberId: null as number | null, error: `Failed to validate token: ${tokenErr.message}` };
  }

  const memberId = Number(
    (tokenRows?.[0] as { memberid?: number | string | null } | undefined)?.memberid ?? 0,
  );
  if (!Number.isFinite(memberId) || memberId <= 0) {
    return { memberId: null as number | null, error: "Invalid or inactive registration token." };
  }

  const { data: memberRows, error: memberErr } = await supabase
    .from("emcmember")
    .select("id,statusid,baptized")
    .eq("id", memberId)
    .limit(1);
  if (memberErr) {
    return { memberId: null as number | null, error: `Failed to validate member: ${memberErr.message}` };
  }

  const member = ((memberRows ?? []) as MemberEligibilityRow[])[0];
  if (!member || member.statusid !== 1 || member.baptized !== true) {
    return { memberId: null as number | null, error: "This registration link is no longer valid." };
  }

  return { memberId, error: "" };
}

export default async function FotRegisterStartPage({
  searchParams,
}: {
  searchParams: PageSearchParams;
}) {
  const params = await searchParams;
  const rawToken = toText(params.t);
  const { memberId, error: tokenError } = await resolveMemberIdFromToken(rawToken);

  const [{ cards, error: cardsError }, { firstName, registeredLocationName, error: memberError }] =
    await Promise.all([
      memberId ? loadSiteCards() : Promise.resolve({ cards: [] as SiteCard[], error: "" }),
      loadMemberContext(memberId),
    ]);

  const error = [tokenError, cardsError, memberError].filter(Boolean).join(" ");
  const pageTitle = firstName ? `Welcome ${firstName}` : "Welcome";
  const subtitle = registeredLocationName
    ? `You have already registered to attend the ${FOT_YEAR} Feast of Tabernacles at ${registeredLocationName}.`
    : `${FOT_YEAR} Feast of Tabernacles Registration`;
  const tokenSuffix = rawToken ? `?t=${encodeURIComponent(rawToken)}` : "";

  return (
    <main className={`${forms.page} ${forms.pageNarrow}`}>
      <h1 className={forms.h1}>{pageTitle}</h1>
      <p className={styles.subtitle}>{subtitle}</p>
      {memberId ? (
        <p className={styles.intro}>
        Please choose the site where you plan to attend. If you are not
        attending any site this year, select the non-attending option below.
        </p>
      ) : null}
      {memberId ? (
        <p className={styles.important}>
        IMPORTANT: Registering on this site does not automatically reserve a
        hotel room. To book your accommodation, you must use the Booking link
        provided for your chosen hotel below. This link will take you directly
        to the hotel&apos;s official reservation page, where you can complete
        your booking.
        </p>
      ) : null}

      {memberId ? (
        <div className={styles.summaryWrap} aria-label="Registration summary index">
        <div className={styles.summaryRow}>
          <span className={styles.summaryLabel}>Not Attending Any Site</span>
          <Link
            href={`/fot-reg/register/not-attending${tokenSuffix}`}
            className={`${forms.linkButton} ${styles.summaryDanger}`}
          >
            Click Here
          </Link>
        </div>
        <div className={styles.summaryRow}>
          <span className={styles.summaryLabel}>United States</span>
          <a
            href="#site-us"
            className={`${forms.linkButton} ${styles.summaryButton}`}
          >
            Pigeon Forge, Tennessee
          </a>
        </div>
        <div className={styles.summaryRow}>
          <span className={styles.summaryLabel}>Australia</span>
          <a
            href="#site-au"
            className={`${forms.linkButton} ${styles.summaryButton}`}
          >
            Surfers Paradise, Australia
          </a>
        </div>
        <div className={styles.summaryRow}>
          <span className={styles.summaryLabel}>Canada</span>
          <a
            href="#site-ca"
            className={`${forms.linkButton} ${styles.summaryButton}`}
          >
            Niagara-on-the-Lake, Ontario
          </a>
        </div>
        <div className={styles.summaryRow}>
          <span className={styles.summaryLabel}>Netherlands</span>
          <a
            href="#site-nl"
            className={`${forms.linkButton} ${styles.summaryButton}`}
          >
            Zaandam, Netherlands
          </a>
        </div>
        </div>
      ) : null}

      {error ? <p className={forms.error}>{error}</p> : null}

      {!error && memberId && cards.length === 0 ? (
        <p>No active FoT locations were found for {FOT_YEAR}.</p>
      ) : null}

      {memberId ? (
        <section className={styles.cardsWrap} aria-label="FoT sites">
        {cards.map((site) => {
          const siteKey = inferSiteKey(site.name);
          return (
            <article
              key={site.id}
              id={siteKey ? `site-${siteKey}` : `site-${site.id}`}
              className={styles.siteCard}
            >
              <div className={styles.cardBody}>
                <h2 className={styles.siteTitle}>{site.name}</h2>
                <div className={`${forms.actions} ${styles.siteRegisterRow}`}>
                  <Link
                    href={`/fot-reg/register/site?siteId=${encodeURIComponent(site.id)}${rawToken ? `&t=${encodeURIComponent(rawToken)}` : ""}`}
                    className={forms.linkButton}
                  >
                    Register for this site
                  </Link>
                </div>
                <div className={styles.contentMd}>
                  <div className={styles.imageFloatWrap}>
                    {isExternalImage(site.imageSrc) ? (
                      <Image
                        loader={passthroughLoader}
                        unoptimized
                        src={site.imageSrc}
                        alt={`${site.name} photo`}
                        width={1200}
                        height={628}
                        className={styles.imageNative}
                      />
                    ) : (
                      <Image
                        src={site.imageSrc}
                        alt={`${site.name} photo`}
                        fill
                        className={styles.image}
                        sizes="(max-width: 768px) 100vw, 360px"
                      />
                    )}
                  </div>
                  {renderHardcodedLocationContent(site)}
                </div>
              </div>
            </article>
          );
        })}
        </section>
      ) : null}
    </main>
  );
}
