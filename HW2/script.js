// Number of recommendations shown in each column
const TOP_N = 5;

// IDs of the three movie dropdowns
const SELECT_IDS = ['movie-select-1', 'movie-select-2', 'movie-select-3'];

// Initialize the application when the window loads
window.onload = async function() {
    try {
        // Display loading message
        const resultElement = document.getElementById('result');
        resultElement.textContent = "Loading movie data...";
        resultElement.className = 'loading';

        // Load data
        await loadData();

        // Populate dropdowns and update status
        populateMoviesDropdowns();
        resultElement.textContent = "Data loaded. Please select up to three movies.";
        resultElement.className = 'success';
    } catch (error) {
        console.error('Initialization error:', error);
        // Error message already set in data.js
    }
};

// Populate all three dropdowns with sorted movie titles
function populateMoviesDropdowns() {
    // Sort movies alphabetically by title
    const sortedMovies = [...movies].sort((a, b) => a.title.localeCompare(b.title));

    // u.item lists some titles twice under different ids; show the id for those
    const titleCounts = new Map();
    for (const movie of movies) {
        titleCounts.set(movie.title, (titleCounts.get(movie.title) || 0) + 1);
    }

    for (const selectId of SELECT_IDS) {
        const selectElement = document.getElementById(selectId);

        // Clear existing options except the first placeholder
        while (selectElement.options.length > 1) {
            selectElement.remove(1);
        }

        sortedMovies.forEach(movie => {
            const option = document.createElement('option');
            option.value = movie.id;
            option.textContent = titleCounts.get(movie.title) > 1
                ? `${movie.title} [#${movie.id}]`
                : movie.title;
            selectElement.appendChild(option);
        });
    }
}

// ---------- Vector math ----------

// Turn a movie's genres into an 18-dimensional 0/1 vector (same order as genreNames)
function toVector(movie) {
    return genreNames.map(genre => movie.genres.includes(genre) ? 1 : 0);
}

function dotProduct(a, b) {
    let sum = 0;
    for (let i = 0; i < a.length; i++) {
        sum += a[i] * b[i];
    }
    return sum;
}

function vectorLength(a) {
    return Math.sqrt(dotProduct(a, a));
}

// Cosine similarity: (a·b) / (|a|·|b|); 0 when either vector is all zeros (avoids NaN)
function cosineSimilarity(a, b) {
    const denominator = vectorLength(a) * vectorLength(b);
    return denominator === 0 ? 0 : dotProduct(a, b) / denominator;
}

// Average the genre vectors of the selected movies into one profile vector.
// Movies without genres carry no information, so they are left out; returns null if none are left.
function buildProfile(selectedMovies) {
    const withGenres = selectedMovies.filter(movie => movie.genres.length > 0);
    if (withGenres.length === 0) return null;

    const profile = new Array(genreNames.length).fill(0);
    for (const movie of withGenres) {
        toVector(movie).forEach((value, i) => { profile[i] += value; });
    }
    return profile.map(value => value / withGenres.length);
}

// ---------- Ranking ----------

// Score every candidate against targetVector and return the top TOP_N.
// Excludes the selected movies, movies sharing a title with them (duplicate ids in u.item)
// and movies without genres. Ties are broken by movie id so the order is deterministic.
function rankMovies(targetVector, selectedMovies, scoreFn) {
    const excludedIds = new Set(selectedMovies.map(movie => movie.id));
    const excludedTitles = new Set(selectedMovies.map(movie => movie.title));

    const scored = movies
        .filter(movie => !excludedIds.has(movie.id)
            && !excludedTitles.has(movie.title)
            && movie.genres.length > 0)
        .map(movie => ({ ...movie, score: scoreFn(targetVector, toVector(movie)) }));

    scored.sort((a, b) => {
        const diff = b.score - a.score;
        return Math.abs(diff) > 1e-12 ? diff : a.id - b.id;
    });

    // Keep only one entry per title
    const seenTitles = new Set();
    const top = [];
    for (const movie of scored) {
        if (seenTitles.has(movie.title)) continue;
        seenTitles.add(movie.title);
        top.push(movie);
        if (top.length === TOP_N) break;
    }
    return top;
}

// Compute all three recommendation lists for the selected movies.
// A list is null when it cannot be computed (no genre data).
function computeRecommendations(selectedMovies) {
    const anchor = selectedMovies[0];
    const profile = buildProfile(selectedMovies);

    return {
        profile,
        skipped: selectedMovies.filter(movie => movie.genres.length === 0),
        itemToItem: anchor.genres.length > 0
            ? rankMovies(toVector(anchor), selectedMovies, cosineSimilarity)
            : null,
        profileCosine: profile ? rankMovies(profile, selectedMovies, cosineSimilarity) : null,
        profileDot: profile ? rankMovies(profile, selectedMovies, dotProduct) : null
    };
}

// Summary metrics shown under each column
function computeMetrics(list, selectedMovies) {
    const selectedIds = new Set(selectedMovies.map(movie => movie.id));
    const uniqueGenres = new Set(list.flatMap(movie => movie.genres));
    const average = values => values.reduce((sum, v) => sum + v, 0) / values.length;

    return {
        avgRatings: average(list.map(movie => movie.ratingCount)),
        uniqueGenres: uniqueGenres.size,
        avgGenres: average(list.map(movie => movie.genres.length)),
        overlapWithSelected: list.filter(movie => selectedIds.has(movie.id)).length
    };
}

// Number of titles two lists have in common
function countOverlap(listA, listB) {
    const titles = new Set(listA.map(movie => movie.title));
    return listB.filter(movie => titles.has(movie.title)).length;
}

// ---------- UI ----------

// Main function, triggered by the button click
function getRecommendations() {
    const resultElement = document.getElementById('result');
    const profileBox = document.getElementById('profile-box');
    const columnsElement = document.getElementById('columns');

    profileBox.hidden = true;
    columnsElement.replaceChildren();

    // Collect the selected movies (Movie 1 is required, duplicates are ignored)
    const selectedIds = [];
    for (const selectId of SELECT_IDS) {
        const id = parseInt(document.getElementById(selectId).value);
        if (!isNaN(id) && !selectedIds.includes(id)) selectedIds.push(id);
    }

    if (isNaN(parseInt(document.getElementById(SELECT_IDS[0]).value))) {
        resultElement.textContent = "Please select Movie 1 first.";
        resultElement.className = 'error';
        return;
    }

    const selectedMovies = selectedIds.map(id => movies.find(movie => movie.id === id));
    if (selectedMovies.some(movie => !movie)) {
        resultElement.textContent = "Error: Selected movie not found in database.";
        resultElement.className = 'error';
        return;
    }

    const results = computeRecommendations(selectedMovies);

    // Status line
    const titles = selectedMovies.map(movie => `"${movie.title}"`).join(', ');
    let status = `Because you liked ${titles}:`;
    if (results.skipped.length > 0) {
        status += ` (${results.skipped.map(movie => movie.title).join(', ')} has no genre data and was left out of the profile.)`;
    }
    resultElement.textContent = status;
    resultElement.className = 'success';

    renderProfile(profileBox, results.profile);

    const lists = [results.itemToItem, results.profileCosine, results.profileDot];
    const columns = [
        { title: 'Item-to-Item', subtitle: `Cosine to "${selectedMovies[0].title}"`, scoreLabel: 'cos' },
        { title: 'Profile (cosine)', subtitle: 'Cosine to the averaged profile', scoreLabel: 'cos' },
        { title: 'Profile (no normalization)', subtitle: 'Dot product with the profile', scoreLabel: 'dot' }
    ];

    columns.forEach((column, i) => {
        const others = lists
            .map((list, j) => ({ list, name: columns[j].title }))
            .filter((other, j) => j !== i && other.list);
        columnsElement.appendChild(renderColumn(column, lists[i], selectedMovies, others));
    });
}

// Show the profile vector as "Genre weight" chips
function renderProfile(profileBox, profile) {
    profileBox.replaceChildren();
    if (!profile) return;

    const label = document.createElement('strong');
    label.textContent = 'Your profile: ';
    profileBox.appendChild(label);

    genreNames
        .map((genre, i) => ({ genre, weight: profile[i] }))
        .filter(entry => entry.weight > 0)
        .sort((a, b) => b.weight - a.weight)
        .forEach(entry => {
            const chip = document.createElement('span');
            chip.className = 'chip';
            chip.textContent = `${entry.genre} ${entry.weight.toFixed(2)}`;
            profileBox.appendChild(chip);
        });
    profileBox.hidden = false;
}

// Build one result column: header, Top-N list and metrics
function renderColumn(column, list, selectedMovies, others) {
    const columnElement = document.createElement('div');
    columnElement.className = 'column';

    const heading = document.createElement('h2');
    heading.textContent = column.title;
    const subtitle = document.createElement('div');
    subtitle.className = 'subtitle';
    subtitle.textContent = column.subtitle;
    columnElement.append(heading, subtitle);

    if (!list) {
        const message = document.createElement('div');
        message.className = 'error';
        message.textContent = 'No genre data for this selection, so no recommendations can be computed.';
        columnElement.appendChild(message);
        return columnElement;
    }

    const listElement = document.createElement('ol');
    for (const movie of list) {
        const item = document.createElement('li');

        const title = document.createElement('div');
        title.className = 'movie-title';
        title.textContent = movie.title;

        const genres = document.createElement('div');
        movie.genres.forEach(genre => {
            const chip = document.createElement('span');
            chip.className = 'chip';
            chip.textContent = genre;
            genres.appendChild(chip);
        });

        const meta = document.createElement('div');
        meta.className = 'meta';
        meta.textContent = `${column.scoreLabel} ${movie.score.toFixed(3)} · ${movie.ratingCount} ratings`;

        item.append(title, genres, meta);
        listElement.appendChild(item);
    }
    columnElement.appendChild(listElement);

    const metrics = computeMetrics(list, selectedMovies);
    const metricsElement = document.createElement('div');
    metricsElement.className = 'metrics';
    const lines = [
        `Avg. number of ratings: ${metrics.avgRatings.toFixed(1)}`,
        `Unique genres in Top-${TOP_N}: ${metrics.uniqueGenres}`,
        `Avg. genres per movie: ${metrics.avgGenres.toFixed(2)}`,
        `Overlap with selected movies: ${metrics.overlapWithSelected}`,
        ...others.map(other => `Overlap with ${other.name}: ${countOverlap(list, other.list)}`)
    ];
    lines.forEach(text => {
        const line = document.createElement('div');
        line.textContent = text;
        metricsElement.appendChild(line);
    });
    columnElement.appendChild(metricsElement);

    return columnElement;
}
