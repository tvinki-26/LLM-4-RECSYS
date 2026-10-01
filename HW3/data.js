// Global variables for storing movie and rating data
let movies = [];
let ratings = [];

// Collaborative filtering structures (populated by buildRatingMatrix)
let numUsers = 0;          // highest user id found in u.data
let numMovies = 0;         // number of parsed movies
let ratingMatrix = null;   // (numUsers + 1) x (numMovies + 1); 0 = "not rated"

// Genre names as defined in the u.item file
const genreNames = [
    "Action", "Adventure", "Animation", "Children's", "Comedy",
    "Crime", "Documentary", "Drama", "Fantasy", "Film-Noir",
    "Horror", "Musical", "Mystery", "Romance", "Sci-Fi",
    "Thriller", "War", "Western"
];

// Primary function to load data from files
async function loadData() {
    try {
        // Load and parse movie data
        const moviesResponse = await fetch('u.item');
        if (!moviesResponse.ok) {
            throw new Error(`Failed to load movie data: ${moviesResponse.status}`);
        }
        // u.item is Latin-1 encoded (e.g. "Misérables"), so decode it explicitly instead of as UTF-8
        const moviesText = new TextDecoder('iso-8859-1').decode(await moviesResponse.arrayBuffer());
        parseItemData(moviesText);

        // Load and parse rating data
        const ratingsResponse = await fetch('u.data');
        if (!ratingsResponse.ok) {
            throw new Error(`Failed to load rating data: ${ratingsResponse.status}`);
        }
        const ratingsText = await ratingsResponse.text();
        parseRatingData(ratingsText);

        // Derive matrix dimensions, then build the rating matrix
        numUsers = ratings.reduce((max, r) => Math.max(max, r.userId), 0);
        numMovies = movies.length;
        buildRatingMatrix();
    } catch (error) {
        console.error('Error loading data:', error);
        const errorTarget = document.getElementById('user-based-result');
        if (errorTarget) {
            errorTarget.innerHTML = `<p class="error">Error: ${error.message}. Please make sure u.item and u.data are in the correct location.</p>`;
        }
        throw error; // Re-throw so script.js can handle the error
    }
}

// Parse movie data from u.item format
function parseItemData(text) {
    const lines = text.split('\n');

    for (const line of lines) {
        if (line.trim() === '') continue;

        const fields = line.split('|');
        if (fields.length < 5) continue; // Skip invalid lines

        const id = parseInt(fields[0]);
        const title = fields[1];

        // Extract genres: skip field 5 ("unknown"), fields 6-23 map to genreNames
        const genreValues = fields.slice(6, 24).map(value => parseInt(value));
        const genres = genreNames.filter((_, index) => genreValues[index] === 1);

        movies.push({ id, title, genres });
    }
}

// Parse rating data from u.data format
function parseRatingData(text) {
    const lines = text.split('\n');

    for (const line of lines) {
        if (line.trim() === '') continue;

        const fields = line.split('\t');
        if (fields.length < 4) continue; // Skip invalid lines

        const userId = parseInt(fields[0]);
        const itemId = parseInt(fields[1]);
        const rating = parseFloat(fields[2]);
        const timestamp = parseInt(fields[3]);

        ratings.push({ userId, itemId, rating, timestamp });
    }
}

// ---------------------------------------------------------------------------
// Build the user-item rating matrix.
//
// Shape: (numUsers + 1) x (numMovies + 1), indexed by raw id, so that
//   ratingMatrix[userId][movieId] === rating
// and a missing entry is 0. MovieLens ratings are 1-5, so 0 is unambiguous:
// cosineSimilarity in script.js treats 0 as "not rated" and compares
// co-rated entries only. Row 0 and column 0 are unused (ids start at 1).
//
// Each row is a Float32Array: zero-filled on creation and compact
// (944 x 1683 cells instead of ~1.6M boxed numbers).
// ---------------------------------------------------------------------------
function buildRatingMatrix() {
    ratingMatrix = [];
    for (let userId = 0; userId <= numUsers; userId++) {
        ratingMatrix.push(new Float32Array(numMovies + 1));
    }

    for (const { userId, itemId, rating } of ratings) {
        // Skip ratings that point outside the matrix (unknown movie id)
        if (itemId < 1 || itemId > numMovies) continue;
        ratingMatrix[userId][itemId] = rating;
    }
}
