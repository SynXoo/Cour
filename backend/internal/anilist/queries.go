package anilist

// One shared field set so every sync path upserts identical data.
const mediaFields = `
  id
  title { romaji english native }
  synonyms
  description(asHtml: false)
  format
  status(version: 2)
  season
  seasonYear
  episodes
  duration
  genres
  tags { name rank }
  studios { edges { isMain node { name } } }
  coverImage { extraLarge color }
  bannerImage
  averageScore
  popularity
  trending
  isAdult
  updatedAt
  nextAiringEpisode { airingAt episode }
`

const querySeasonPage = `
query ($season: MediaSeason!, $seasonYear: Int!, $page: Int!, $perPage: Int!) {
  Page(page: $page, perPage: $perPage) {
    pageInfo { hasNextPage }
    media(season: $season, seasonYear: $seasonYear, type: ANIME, sort: POPULARITY_DESC) {` + mediaFields + `}
  }
}`

const queryTrendingPage = `
query ($page: Int!, $perPage: Int!) {
  Page(page: $page, perPage: $perPage) {
    pageInfo { hasNextPage }
    media(type: ANIME, sort: TRENDING_DESC) {` + mediaFields + `}
  }
}`

// Catalog crawl. AniList caps offset pagination at 5,000 entries per query
// and offers no id/updatedAt range filters, so the crawl is partitioned into
// windows (startDate ranges or a status), each safely under the cap. The
// window variables are nullable: a variable left out of the request means
// that filter simply isn't applied.
const queryCatalogPage = `
query ($page: Int!, $perPage: Int!, $status: MediaStatus, $dateGreater: FuzzyDateInt, $dateLesser: FuzzyDateInt) {
  Page(page: $page, perPage: $perPage) {
    pageInfo { hasNextPage }
    media(type: ANIME, status: $status, startDate_greater: $dateGreater, startDate_lesser: $dateLesser, sort: ID) {` + mediaFields + `}
  }
}`

// No updatedAt range filter exists either; the delta sync orders by edit time
// and the caller stops paging once it sees entries older than its watermark.
const queryUpdatedPage = `
query ($page: Int!, $perPage: Int!) {
  Page(page: $page, perPage: $perPage) {
    pageInfo { hasNextPage }
    media(type: ANIME, sort: UPDATED_AT_DESC) {` + mediaFields + `}
  }
}`

// Full media fields on schedule entries so shows we haven't seen yet (e.g.
// leftover cours from a previous season) get complete records on first sight.
const queryAiringRange = `
query ($from: Int!, $to: Int!, $page: Int!) {
  Page(page: $page, perPage: 50) {
    pageInfo { hasNextPage }
    airingSchedules(airingAt_greater: $from, airingAt_lesser: $to, sort: TIME) {
      episode
      airingAt
      media {` + mediaFields + `}
    }
  }
}`
