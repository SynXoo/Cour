package anilist

// User-list fetching for the import pipeline (docs/PHASE_2.md §M1): one
// MediaListCollection query returns a public list in full — no pagination,
// no OAuth. Score conversion is deliberately NOT done here (AniList could do
// it server-side via score(format:)): the import spec owns the conversion
// rules and unit-tests them, so the client hands over raw scores plus the
// user's score format.

import (
	"context"
)

// UserList is one AniList user's complete anime list.
type UserList struct {
	// ScoreFormat is the user's scoring system: POINT_100, POINT_10_DECIMAL,
	// POINT_10, POINT_5, or POINT_3. Scores on entries are raw values in
	// this system.
	ScoreFormat string
	Entries     []UserListEntry
}

// UserListEntry is one list row with the media fields matching needs.
type UserListEntry struct {
	// Status: CURRENT, PLANNING, COMPLETED, DROPPED, PAUSED, REPEATING.
	Status string `json:"status"`
	// Score is raw, in the user's ScoreFormat units; 0 = unscored.
	Score       float64       `json:"score"`
	Progress    int           `json:"progress"`
	StartedAt   FuzzyDate     `json:"startedAt"`
	CompletedAt FuzzyDate     `json:"completedAt"`
	Media       UserListMedia `json:"media"`
}

// UserListMedia carries identity plus the attributes the matcher validates
// against (format/year) when it has to fall back to title matching.
type UserListMedia struct {
	ID         int     `json:"id"`
	IDMal      *int    `json:"idMal"`
	Title      Title   `json:"title"`
	Format     *string `json:"format"`
	SeasonYear *int    `json:"seasonYear"`
	Episodes   *int    `json:"episodes"`
}

// FuzzyDate is AniList's partial date; zero fields mean unknown.
type FuzzyDate struct {
	Year  int `json:"year"`
	Month int `json:"month"`
	Day   int `json:"day"`
}

const queryUserList = `
query ($userName: String!) {
  MediaListCollection(userName: $userName, type: ANIME) {
    user { mediaListOptions { scoreFormat } }
    lists {
      isCustomList
      entries {
        status
        score
        progress
        startedAt { year month day }
        completedAt { year month day }
        media { id idMal title { romaji english } format seasonYear episodes }
      }
    }
  }
}`

// UserList fetches a user's public anime list. AniList reports unknown
// users and private lists as GraphQL errors, which surface as *GraphQLError.
// Entries appearing on custom lists as well as a status list are returned
// once (custom list groups are skipped).
func (c *Client) UserList(ctx context.Context, username string) (UserList, error) {
	var out struct {
		Collection struct {
			User struct {
				MediaListOptions struct {
					ScoreFormat string `json:"scoreFormat"`
				} `json:"mediaListOptions"`
			} `json:"user"`
			Lists []struct {
				IsCustomList bool            `json:"isCustomList"`
				Entries      []UserListEntry `json:"entries"`
			} `json:"lists"`
		} `json:"MediaListCollection"`
	}
	if err := c.do(ctx, queryUserList, map[string]any{"userName": username}, &out); err != nil {
		return UserList{}, err
	}

	list := UserList{ScoreFormat: out.Collection.User.MediaListOptions.ScoreFormat}
	seen := map[int]bool{}
	for _, group := range out.Collection.Lists {
		if group.IsCustomList {
			continue
		}
		for _, e := range group.Entries {
			if e.Media.ID <= 0 || seen[e.Media.ID] {
				continue
			}
			seen[e.Media.ID] = true
			list.Entries = append(list.Entries, e)
		}
	}
	return list, nil
}
