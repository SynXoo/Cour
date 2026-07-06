package anilist

// Media mirrors the AniList GraphQL Media type, limited to the fields Cour
// stores. Field names match AniList's JSON exactly.
type Media struct {
	ID           int      `json:"id"`
	Title        Title    `json:"title"`
	Synonyms     []string `json:"synonyms"`
	Description  *string  `json:"description"`
	Format       *string  `json:"format"`
	Status       *string  `json:"status"`
	Season       *string  `json:"season"`
	SeasonYear   *int     `json:"seasonYear"`
	Episodes     *int     `json:"episodes"`
	Duration     *int     `json:"duration"`
	Genres       []string `json:"genres"`
	Tags         []Tag    `json:"tags"`
	Studios      Studios  `json:"studios"`
	CoverImage   Cover    `json:"coverImage"`
	BannerImage  *string  `json:"bannerImage"`
	AverageScore *int     `json:"averageScore"`
	Popularity   int      `json:"popularity"`
	Trending     int      `json:"trending"`
	IsAdult      bool     `json:"isAdult"`
	UpdatedAt    *int64   `json:"updatedAt"` // unix seconds of last upstream edit
	NextAiring   *Airing  `json:"nextAiringEpisode"`
}

type Title struct {
	Romaji  string  `json:"romaji"`
	English *string `json:"english"`
	Native  *string `json:"native"`
}

type Tag struct {
	Name string `json:"name"`
	Rank int    `json:"rank"`
}

type Studios struct {
	Edges []StudioEdge `json:"edges"`
}

type StudioEdge struct {
	IsMain bool `json:"isMain"`
	Node   struct {
		Name string `json:"name"`
	} `json:"node"`
}

type Cover struct {
	ExtraLarge *string `json:"extraLarge"`
	Color      *string `json:"color"`
}

type Airing struct {
	AiringAt int64 `json:"airingAt"` // unix seconds
	Episode  int   `json:"episode"`
}

type AiringSchedule struct {
	Episode  int   `json:"episode"`
	AiringAt int64 `json:"airingAt"` // unix seconds
	Media    Media `json:"media"`
}
