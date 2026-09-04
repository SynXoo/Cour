package discovery

import (
	"testing"

	"github.com/stretchr/testify/assert"

	"cour/internal/store/sqlcgen"
)

func TestSharedGenresKeepsViewerOrderAndCap(t *testing.T) {
	anime := []string{"Action", "Drama", "Fantasy", "Romance"}
	viewer := []string{"Romance", "Comedy", "Drama", "Action"}
	assert.Equal(t, []string{"Romance", "Drama"}, sharedGenres(anime, viewer, 2))
	assert.Equal(t, []string{"Romance", "Drama", "Action"}, sharedGenres(anime, viewer, 5))
	assert.Equal(t, []string{}, sharedGenres(anime, nil, 2), "empty, never nil — it serializes as []")
}

func TestAddSignalBuckets(t *testing.T) {
	var s Signals
	addSignal(&s, sqlcgen.ActivityTypeComment, 3)
	addSignal(&s, sqlcgen.ActivityTypeListAdd, 5)
	addSignal(&s, sqlcgen.ActivityTypeCompleted, 1)
	addSignal(&s, sqlcgen.ActivityTypeFavorite, 2)
	addSignal(&s, sqlcgen.ActivityTypeReview, 1)
	addSignal(&s, sqlcgen.ActivityTypeScored, 4)
	addSignal(&s, sqlcgen.ActivityTypeProgress, 40) // low-signal types don't get a bucket
	assert.Equal(t, Signals{Comments: 3, ListAdds: 5, Completed: 1, Favorites: 2, Reviews: 1, Scored: 4}, s)
}
