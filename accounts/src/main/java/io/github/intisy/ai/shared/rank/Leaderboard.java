package io.github.intisy.ai.shared.rank;

import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * Ranks a catalog of models by live quality score. Matching and effort are derived from a model's
 * DISPLAY NAME, because the catalog id is an opaque vendor rawId that carries neither the model name
 * nor its effort setting.
 *
 * <p>Scores arrive as data: fetching them, caching them and choosing between the keyless and
 * key-holding sources all stay on the calling side, so this class is a pure ranking engine.
 *
 * @implNote Ordering is score-first, then by the base model's earliest catalog position, then by
 * effort, then by catalog position. Grouping on the base's earliest position is what makes the
 * comparator a total order: ordering variants against each other by effort while ordering different
 * models by catalog position is intransitive (X-low before Y before X-thinking, yet X-thinking
 * before X-low), which sorts to an ungrouped result and makes a merge sort reject the comparator
 * outright.
 */
public final class Leaderboard {
    /** No live score for a key. Scores are non-negative, so it cannot collide with a real one. */
    public static final double NO_SCORE = -1;

    /** One live quality score, against the normalized name or id it was published under. */
    public static final class Score {
        /** The name or id this score was published under, already run through {@link #normalize}. */
        public final String norm;
        /** The live quality score for {@link #norm}. */
        public final double score;

        /**
         * @param norm the name or id this score was published under
         * @param score the live quality score for it
         */
        public Score(String norm, double score) {
            this.norm = norm == null ? "" : norm;
            this.score = score;
        }
    }

    private static final Pattern VARIANT_TOKENS = Pattern.compile(
            "\\b(minimal|extra[\\s_-]?low|low|medium|high|thinking|agent|preview|customtools|reasoning)\\b");
    private static final Pattern NON_ALPHANUMERIC = Pattern.compile("[^a-z0-9]");
    private static final Pattern PARENTHESISED = Pattern.compile("\\([^)]*\\)");
    private static final Pattern DIGITS = Pattern.compile("[0-9]+");

    private static final Pattern THINKING = Pattern.compile("(^|[^a-z])thinking([^a-z]|$)");
    private static final Pattern EXTRA_LOW = Pattern.compile("extra[\\s_-]?low");
    private static final Pattern HIGH = Pattern.compile("(^|[^a-z])high([^a-z]|$)");
    private static final Pattern MEDIUM = Pattern.compile("(^|[^a-z])medium([^a-z]|$)");
    private static final Pattern LOW = Pattern.compile("(^|[^a-z])low([^a-z]|$)");
    private static final Pattern MINIMAL = Pattern.compile("(^|[^a-z])minimal([^a-z]|$)");

    private static final int FAMILY_MIN_LENGTH = 4;

    private Leaderboard() {
    }

    /**
     * Collapses a name or id to a matching key: lowercase, effort and variant tokens dropped, then
     * everything but letters and digits removed, so every variant of one model shares a key.
     *
     * @param name the display name or catalog id to collapse
     * @return the matching key, or the empty string for {@code null}
     */
    public static String normalize(String name) {
        if (name == null) return "";
        String lower = name.toLowerCase(Locale.ROOT);
        return NON_ALPHANUMERIC.matcher(VARIANT_TOKENS.matcher(lower).replaceAll("")).replaceAll("");
    }

    /**
     * The matching key for a display name, dropping every parenthetical tag first, so the effort
     * "(High)" and the provider label "(Antigravity)" cannot separate a model from its own variants.
     *
     * @param text the display name to collapse
     * @return the matching key, or the empty string for {@code null}
     */
    public static String baseKeyFromName(String text) {
        if (text == null) return "";
        return normalize(PARENTHESISED.matcher(text).replaceAll(" "));
    }

    /**
     * Effort weight, higher first. A name with no effort marker sits mid-range at 3.
     *
     * @param text the display name to read an effort marker from
     * @return the effort weight, from 1 (lowest) to 6 (thinking)
     */
    public static int effortRank(String text) {
        String s = text == null ? "" : text.toLowerCase(Locale.ROOT);
        if (THINKING.matcher(s).find()) return 6;
        if (EXTRA_LOW.matcher(s).find()) return 1;
        if (HIGH.matcher(s).find()) return 5;
        if (MEDIUM.matcher(s).find()) return 4;
        if (LOW.matcher(s).find()) return 2;
        if (MINIMAL.matcher(s).find()) return 1;
        return 3;
    }

    /**
     * The best live score for a normalized base key, or {@link #NO_SCORE}. An exact or either-way
     * substring match wins; failing that a digit-stripped FAMILY match, so a catalog entry still
     * ranks by its family when the score source lists only a different version of it. The family
     * pass is skipped for a very short key, where it would match almost anything.
     *
     * @param key the normalized base key to find a score for
     * @param scores the available live scores
     * @return the best matching score, or {@link #NO_SCORE} when none matches
     */
    public static double scoreForKey(String key, List<Score> scores) {
        if (key == null || scores == null || scores.isEmpty()) return NO_SCORE;

        double best = NO_SCORE;
        for (Score candidate : scores) {
            if (candidate.norm.contains(key) || key.contains(candidate.norm)) {
                best = Math.max(best, candidate.score);
            }
        }
        if (best >= 0) return best;

        String family = DIGITS.matcher(key).replaceAll("");
        if (family.length() < FAMILY_MIN_LENGTH) return NO_SCORE;
        for (Score candidate : scores) {
            String candidateFamily = DIGITS.matcher(candidate.norm).replaceAll("");
            if (candidateFamily.isEmpty()) continue;
            if (candidateFamily.contains(family) || family.contains(candidateFamily)) {
                best = Math.max(best, candidate.score);
            }
        }
        return best;
    }

    /**
     * {@code ids} sorted best-first, where {@code names} holds each id's display name at the same
     * position. Variants of one model group together at their shared score and are ordered by effort
     * among themselves; effort never decides the order between different models, and an unscored
     * model keeps its catalog position behind every scored one.
     *
     * @param ids the catalog ids to order
     * @param names each id's display name at the same position, or {@code null} to fall back to the id
     * @param scores the available live scores
     * @return {@code ids}, reordered best-first
     */
    public static List<String> order(List<String> ids, List<String> names, List<Score> scores) {
        List<Entry> entries = entriesOf(ids, names, scores);

        final Map<String, Integer> groupPosition = new HashMap<String, Integer>();
        for (Entry entry : entries) {
            Integer seen = groupPosition.get(entry.base);
            if (seen == null || entry.position < seen.intValue()) {
                groupPosition.put(entry.base, Integer.valueOf(entry.position));
            }
        }

        Collections.sort(entries, new Comparator<Entry>() {
            @Override
            public int compare(Entry a, Entry b) {
                boolean aScored = a.score >= 0;
                boolean bScored = b.score >= 0;
                if (aScored != bScored) return aScored ? -1 : 1;
                if (aScored && a.score != b.score) return a.score > b.score ? -1 : 1;

                int groups = groupPosition.get(a.base).compareTo(groupPosition.get(b.base));
                if (groups != 0) return groups;
                if (a.effort != b.effort) return b.effort - a.effort;
                return a.position - b.position;
            }
        });

        List<String> ordered = new ArrayList<String>();
        for (Entry entry : entries) ordered.add(entry.id);
        return ordered;
    }

    /**
     * The live score per id, carrying only the ids that matched a score.
     *
     * @param ids the catalog ids to look up
     * @param names each id's display name at the same position, or {@code null} to fall back to the id
     * @param scores the available live scores
     * @return a map from id to score, for the ids that matched
     */
    public static Map<String, Double> scoresFor(List<String> ids, List<String> names, List<Score> scores) {
        Map<String, Double> out = new LinkedHashMap<String, Double>();
        for (Entry entry : entriesOf(ids, names, scores)) {
            if (entry.score >= 0) out.put(entry.id, Double.valueOf(entry.score));
        }
        return out;
    }

    /**
     * Compact tag for a row hint; the full provenance goes in a subtitle.
     *
     * @param source the full source provenance string, or {@code null}/empty for none
     * @return {@code "AA"} when a source is present, else the empty string
     */
    public static String sourceShort(String source) {
        return source != null && !source.isEmpty() ? "AA" : "";
    }

    private static List<Entry> entriesOf(List<String> ids, List<String> names, List<Score> scores) {
        List<Entry> entries = new ArrayList<Entry>();
        if (ids == null) return entries;
        for (int i = 0; i < ids.size(); i++) {
            String id = ids.get(i);
            String name = names != null && i < names.size() && names.get(i) != null ? names.get(i) : id;
            String base = baseKeyFromName(name);
            entries.add(new Entry(id, i, base, effortRank(name), scoreForKey(base, scores)));
        }
        return entries;
    }

    private static final class Entry {
        final String id;
        final int position;
        final String base;
        final int effort;
        final double score;

        Entry(String id, int position, String base, int effort, double score) {
            this.id = id;
            this.position = position;
            this.base = base;
            this.effort = effort;
            this.score = score;
        }
    }
}
