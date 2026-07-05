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
