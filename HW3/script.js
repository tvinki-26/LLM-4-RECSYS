// ---------------------------------------------------------------------------
// HW3 — Collaborative Filtering core
//
// Missing-value strategy (see week3/readme.md section 6):
//
//   [x] use co-rated entries only
//
// A 0 in ratingMatrix means "not rated" (see buildRatingMatrix in data.js).
// cosineSimilarity ignores every position where either vector is 0, so a
// missing rating is never treated as a low rating. This is the simplest
// option and adds no bias from imputed values; its weakness is that two
// vectors with very few co-rated items can still get a high similarity.
// ---------------------------------------------------------------------------

// Initialize the application when the window loads
window.onload = async function() {
    const userBased = document.getElementById('user-based-result');
    const itemBased = document.getElementById('item-based-result');

    try {
        userBased.innerHTML = '<p>Loading movie data...</p>';
        itemBased.innerHTML = '<p>Loading movie data...</p>';

        await loadData();

        populateUserDropdown();

        userBased.innerHTML = '<p>Data loaded. Select a user.</p>';
        itemBased.innerHTML = '<p>Data loaded. Select a user.</p>';
    } catch (error) {
        console.error('Initialization error:', error);
        // The error message is already shown by data.js
    }
};

// Populate the user dropdown with one option per user id found in u.data
function populateUserDropdown() {
    const selectElement = document.getElementById('user-select');

    // Clear existing options except the first placeholder
    while (selectElement.options.length > 1) {
        selectElement.remove(1);
    }

    for (let userId = 1; userId <= numUsers; userId++) {
        const option = document.createElement('option');
        option.value = userId;
        option.textContent = `User ${userId}`;
        selectElement.appendChild(option);
    }
}

// ---------------------------------------------------------------------------
// Cosine similarity between two rating vectors.
//
// Compares only co-rated (non-zero) entries, per the missing-value strategy
// above. Returns 0 when the denominator is 0 (that is, when the two vectors
// share no rated items). See week3/readme.md section 5.3.
//
// Inputs: two arrays of equal length (a row or column of the rating matrix).
// Output: a number in [0, 1] (ratings are positive, so it is never negative).
// ---------------------------------------------------------------------------
function cosineSimilarity(a, b) {
    let dot = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
        // Skip positions where either side has no rating
        if (a[i] === 0 || b[i] === 0) continue;
        dot += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }

    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    return denominator === 0 ? 0 : dot / denominator;
}

// ---------------------------------------------------------------------------
// User-Based CF.
//
// Return the top-K recommendations for the active user as an array of
// { title, score }, sorted by score descending. The score is the predicted
// rating on the 1-5 scale.
//
// Steps (week3/readme.md section 5.4):
//   1. compare the active user's rating vector against every other user
//   2. take the N most similar users with positive similarity (N = 20)
//   3. for each movie the active user has NOT rated, predict a score as the
//      similarity-weighted average of those users' ratings, skipping movies
//      rated by fewer than MIN_NEIGHBOUR_RATINGS neighbours
//   4. sort and take the top K
// ---------------------------------------------------------------------------
const NUM_NEIGHBOURS = 20;
const MIN_NEIGHBOUR_RATINGS = 3;

function getUserBasedRecommendations(activeUserId, topK = 5) {
    const activeRatings = ratingMatrix[activeUserId];

    // Steps 1-2: find the most similar users
    const neighbours = [];
    for (let userId = 1; userId <= numUsers; userId++) {
        if (userId === activeUserId) continue;

        const similarity = cosineSimilarity(activeRatings, ratingMatrix[userId]);
        if (similarity > 0) {
            neighbours.push({ userId, similarity });
        }
    }
    neighbours.sort((x, y) => y.similarity - x.similarity);
    const topNeighbours = neighbours.slice(0, NUM_NEIGHBOURS);

    // Step 3: predict a rating for every movie the active user has not rated
    const candidates = [];
    for (let movieId = 1; movieId <= numMovies; movieId++) {
        if (activeRatings[movieId] !== 0) continue;

        let weightedSum = 0;
        let similaritySum = 0;
        let raters = 0;
        for (const { userId, similarity } of topNeighbours) {
            const rating = ratingMatrix[userId][movieId];
            if (rating === 0) continue;
            weightedSum += similarity * rating;
            similaritySum += similarity;
            raters++;
        }

        if (raters >= MIN_NEIGHBOUR_RATINGS) {
            candidates.push({ movieId, score: weightedSum / similaritySum });
        }
    }

    // Step 4: sort by predicted rating and keep the top K
    candidates.sort((x, y) => y.score - x.score);
    return candidates.slice(0, topK).map(({ movieId, score }) => ({
        title: movies[movieId - 1].title,
        score
    }));
}

// ---------------------------------------------------------------------------
// Item-Based CF.
//
// Return the top-K recommendations for the active user as an array of
// { title, score }, sorted by score descending. The score is the aggregated
// similarity: sum over the user's rated movies of similarity * rating.
//
// Steps (week3/readme.md section 5.5):
//   1. for each movie the active user has rated, compute the item-item
//      similarity against every other movie's rating column
//   2. for each candidate movie the active user has NOT rated, aggregate the
//      similarities from the rated movies, weighted by the user's rating
//   3. sort and take the top K
//
// Performance: one recommendation needs (rated movies) x (all movies)
// similarities over 943-element columns, which takes ~1-2 s for a user with
// a few hundred ratings. Columns are built once, and each movie's row of
// similarities is cached, so movies shared with earlier users are free.
// ---------------------------------------------------------------------------
let movieColumns = null;                 // movieColumns[movieId][userId] = rating
const itemSimilarityCache = new Map();   // movieId -> Float32Array of similarities

// Rating column of every movie (ratingMatrix is stored by user rows)
function buildMovieColumns() {
    movieColumns = [];
    for (let movieId = 0; movieId <= numMovies; movieId++) {
        const column = new Float32Array(numUsers + 1);
        for (let userId = 1; userId <= numUsers; userId++) {
            column[userId] = ratingMatrix[userId][movieId];
        }
        movieColumns.push(column);
    }
}

// Similarity of one movie to every movie, computed once and then cached
function getItemSimilarities(movieId) {
    let similarities = itemSimilarityCache.get(movieId);
    if (!similarities) {
        similarities = new Float32Array(numMovies + 1);
        for (let otherId = 1; otherId <= numMovies; otherId++) {
            if (otherId === movieId) continue;
            similarities[otherId] = cosineSimilarity(movieColumns[movieId], movieColumns[otherId]);
        }
        itemSimilarityCache.set(movieId, similarities);
    }
    return similarities;
}

function getItemBasedRecommendations(activeUserId, topK = 5) {
    if (!movieColumns) buildMovieColumns();

    const activeRatings = ratingMatrix[activeUserId];
    const scores = new Float64Array(numMovies + 1);

    // Steps 1-2: add similarity * rating from every movie the user has rated
    for (let ratedId = 1; ratedId <= numMovies; ratedId++) {
        const rating = activeRatings[ratedId];
        if (rating === 0) continue;

        const similarities = getItemSimilarities(ratedId);
        for (let candidateId = 1; candidateId <= numMovies; candidateId++) {
            if (activeRatings[candidateId] !== 0) continue;
            scores[candidateId] += similarities[candidateId] * rating;
        }
    }

    // Step 3: sort the unrated movies by aggregated score and keep the top K
    const candidates = [];
    for (let movieId = 1; movieId <= numMovies; movieId++) {
        if (activeRatings[movieId] === 0 && scores[movieId] > 0) {
            candidates.push({ movieId, score: scores[movieId] });
        }
    }
    candidates.sort((x, y) => y.score - x.score);
    return candidates.slice(0, topK).map(({ movieId, score }) => ({
        title: movies[movieId - 1].title,
        score
    }));
}

// Provided — read the selected user and render both recommendation lists
function getRecommendations() {
    const selectElement = document.getElementById('user-select');
    const userId = parseInt(selectElement.value, 10);

    if (isNaN(userId)) {
        renderList('user-based-result', [], 'Please select a user first.');
        renderList('item-based-result', [], 'Please select a user first.');
        return;
    }

    renderList('user-based-result', getUserBasedRecommendations(userId));
    renderList('item-based-result', getItemBasedRecommendations(userId));
}

// Provided — render a list of { title, score } into the given element
function renderList(elementId, items, message) {
    const el = document.getElementById(elementId);

    if (message) {
        el.innerHTML = `<p>${message}</p>`;
        return;
    }

    if (!items || items.length === 0) {
        el.innerHTML = '<p>No recommendations. (Implement the TODO above.)</p>';
        return;
    }

    const entries = items
        .map(item => `<li>${item.title} &mdash; ${Number(item.score).toFixed(3)}</li>`)
        .join('');
    el.innerHTML = `<ul>${entries}</ul>`;
}
