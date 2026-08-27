package io.github.intisy.ai.shared.store;

import io.github.intisy.ai.shared.model.Account;
import io.github.intisy.ai.shared.model.AccountPool;
import io.github.intisy.ai.api.seam.JsonCodec;
import io.github.intisy.ai.api.seam.Store;

import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.function.Consumer;
import io.github.intisy.ai.seam.JsonUtil;

/**
 * Generic per-provider account store, keyed by provider id, and the only implementation of it:
 * the TypeScript library reaches this class through the TeaVM bundle. Built on the {@link Store} +
 * {@link JsonCodec} SPIs (no direct nio/gson) so it stays transpilable: JSON is built/read as
 * plain {@code Map}/{@code List} trees via {@link JsonUtil}, and atomicity of read-modify-write is
 * the caller's concern, not this class's -- the file-backed store holds a cross-process lock
 * around a whole call rather than around each op.
 *
 * <p>On-disk shape (must match the JS store exactly): {@code {"version":1,"providers":
 * {"<id>":{"accounts":[...],"activeIndex":0,"activeIndexByLane":{}}}}}, under the key
 * {@code "accounts.json"}.
 */
public class AccountStore {
    private static final String KEY = "accounts.json";

    private final Store store;
    private final JsonCodec json;

    /**
     * @param store the key-value backing store, providing atomic read-modify-write per key
     * @param json the codec used to parse and serialize the on-disk document
     */
    public AccountStore(Store store, JsonCodec json) {
        this.store = store;
        this.json = json;
    }

    private Map<String, Object> parseOrDefault(String raw) {
        if (raw != null) {
            try {
                Map<String, Object> doc = JsonUtil.asMap(json.parse(raw));
                if (doc != null) return doc;
            } catch (Exception ignored) {
                // swallow-all: a corrupted store degrades to an empty one rather than throwing
            }
        }
        Map<String, Object> doc = new LinkedHashMap<>();
        doc.put("version", 1);
        doc.put("providers", new LinkedHashMap<String, Object>());
        return doc;
    }

    private static Map<String, Object> providersOf(Map<String, Object> doc) {
        Map<String, Object> providers = JsonUtil.asMap(doc.get("providers"));
        if (providers == null) {
            providers = new LinkedHashMap<>();
            doc.put("providers", providers);
        }
        return providers;
    }

    private static AccountPool poolFromEntry(Object entry) {
        Map<String, Object> m = JsonUtil.asMap(entry);
        if (m == null) return new AccountPool();

        List<Object> rawAccounts = JsonUtil.asList(m.get("accounts"));
        List<Account> accounts = new ArrayList<>();
        if (rawAccounts != null) {
            for (Object o : rawAccounts) {
                Map<String, Object> am = JsonUtil.asMap(o);
                if (am != null) accounts.add(accountFromMap(am));
            }
        }

        Integer activeIndex = JsonUtil.asInt(m.get("activeIndex"));

        Map<String, Integer> activeIndexByLane = new LinkedHashMap<>();
        Map<String, Object> laneRaw = JsonUtil.asMap(m.get("activeIndexByLane"));
        if (laneRaw != null) {
            for (Map.Entry<String, Object> e : laneRaw.entrySet()) {
                Integer v = JsonUtil.asInt(e.getValue());
                if (v != null) activeIndexByLane.put(e.getKey(), v);
            }
        }

        return new AccountPool(accounts, activeIndex != null ? activeIndex : 0, activeIndexByLane);
    }

    private static Map<String, Object> poolToMap(AccountPool pool) {
        Map<String, Object> m = new LinkedHashMap<>();

        List<Object> accounts = new ArrayList<>();
        if (pool.accounts != null) {
            for (Account a : pool.accounts) accounts.add(accountToMap(a));
        }
        m.put("accounts", accounts);
        m.put("activeIndex", pool.activeIndex);

        Map<String, Object> lane = new LinkedHashMap<>();
        if (pool.activeIndexByLane != null) {
            for (Map.Entry<String, Integer> e : pool.activeIndexByLane.entrySet()) {
                lane.put(e.getKey(), e.getValue());
            }
        }
        m.put("activeIndexByLane", lane);
        return m;
    }

    private static Account accountFromMap(Map<String, Object> m) {
        Account a = new Account();
        a.id = JsonUtil.asString(m.get("id"));
        a.email = JsonUtil.asString(m.get("email"));
        a.refresh = JsonUtil.asString(m.get("refresh"));
        a.access = JsonUtil.asString(m.get("access"));
        a.expires = JsonUtil.asLong(m.get("expires"));
        a.addedAt = JsonUtil.asLong(m.get("addedAt"));
        a.lastUsed = JsonUtil.asLong(m.get("lastUsed"));
        a.enabled = JsonUtil.asBoolean(m.get("enabled"));

        Map<String, Object> rlrt = JsonUtil.asMap(m.get("rateLimitResetTimes"));
        if (rlrt != null) {
            Map<String, Long> conv = new LinkedHashMap<>();
            for (Map.Entry<String, Object> e : rlrt.entrySet()) {
                Long v = JsonUtil.asLong(e.getValue());
                if (v != null) conv.put(e.getKey(), v);
            }
            a.rateLimitResetTimes = conv;
        }

        a.coolingDownUntil = JsonUtil.asLong(m.get("coolingDownUntil"));
        a.cooldownReason = JsonUtil.asString(m.get("cooldownReason"));
        a.disabledReason = JsonUtil.asString(m.get("disabledReason"));
        a.meta = JsonUtil.asMap(m.get("meta"));
        return a;
    }

    /** Builds the wire map with only present (non-null) fields, mirroring JS omitting {@code undefined}. */
    private static Map<String, Object> accountToMap(Account a) {
        Map<String, Object> m = new LinkedHashMap<>();
        if (a.id != null) m.put("id", a.id);
        if (a.email != null) m.put("email", a.email);
        if (a.refresh != null) m.put("refresh", a.refresh);
        if (a.access != null) m.put("access", a.access);
        if (a.expires != null) m.put("expires", a.expires);
        if (a.addedAt != null) m.put("addedAt", a.addedAt);
        if (a.lastUsed != null) m.put("lastUsed", a.lastUsed);
        if (a.enabled != null) m.put("enabled", a.enabled);
        if (a.rateLimitResetTimes != null) {
            Map<String, Object> rl = new LinkedHashMap<>();
            for (Map.Entry<String, Long> e : a.rateLimitResetTimes.entrySet()) rl.put(e.getKey(), e.getValue());
            m.put("rateLimitResetTimes", rl);
        }
        if (a.coolingDownUntil != null) m.put("coolingDownUntil", a.coolingDownUntil);
        if (a.cooldownReason != null) m.put("cooldownReason", a.cooldownReason);
        if (a.disabledReason != null) m.put("disabledReason", a.disabledReason);
        if (a.meta != null) m.put("meta", a.meta);
        return m;
    }

    /**
     * @param provider the provider id the pool is keyed by
     * @return the provider's pool, defaulted to empty if none is stored
     */
    public AccountPool load(String provider) {
        Map<String, Object> providers = providersOf(parseOrDefault(store.get(KEY)));
        return poolFromEntry(providers.get(provider));
    }

    /**
     * @param provider the provider id the pool is keyed by
     * @return the provider's accounts, defaulted to empty if none are stored
     */
    public List<Account> list(String provider) {
        return load(provider).accounts;
    }

    /**
     * @param provider the provider id the pool is keyed by
     * @param pool the pool to store, replacing whatever was there
     */
    public void save(String provider, AccountPool pool) {
        store.update(KEY, current -> {
            Map<String, Object> doc = parseOrDefault(current);
            doc.put("version", 1);
            providersOf(doc).put(provider, poolToMap(pool));
            return json.stringify(doc);
        });
    }

    /**
     * Atomic read-modify-write: mutator mutates the freshly-read pool in place.
     *
     * @param provider the provider id the pool is keyed by
     * @param mutator applied to the freshly-read pool before it is written back
     * @return the pool as written back, after {@code mutator} ran
     */
    public AccountPool update(String provider, Consumer<AccountPool> mutator) {
        AccountPool[] result = new AccountPool[1];
        store.update(KEY, current -> {
            Map<String, Object> doc = parseOrDefault(current);
            doc.put("version", 1);
            Map<String, Object> providers = providersOf(doc);
            AccountPool pool = poolFromEntry(providers.get(provider));
            mutator.accept(pool);
            providers.put(provider, poolToMap(pool));
            result[0] = pool;
            return json.stringify(doc);
        });
        return result[0];
    }

    /**
     * Upsert by {@code id}, else by {@code refresh}; merges non-null incoming fields onto the existing record.
     *
     * @param provider the provider id the pool is keyed by
     * @param account the account to add or merge in
     */
    public void add(String provider, Account account) {
        upsertRaw(provider, accountToMap(account));
    }

    /**
     * @param provider the provider id the pool is keyed by
     * @param id the account id to remove
     * @return whether an account with that id was there to remove
     */
    public boolean remove(String provider, String id) {
        return removeRaw(provider, id);
    }

    /**
     * What an {@link #upsertRaw} did, so a caller can report a real change without re-reading the
     * pool. {@code UNCHANGED} is a re-upsert of identical content, which a login refresh does on
     * every call.
     */
    public enum Upsert {
        /** No existing account matched by {@code id} or {@code refresh}; a new record was added. */
        ADDED,
        /** An existing account matched and the merge changed its content. */
        UPDATED,
        /** An existing account matched but the merge produced content identical to what was there. */
        UNCHANGED
    }

    /**
     * Upsert over the account's RAW json map rather than the typed {@link Account}.
     *
     * @implNote raw, because {@link Account} models the declared field set and this store must be
     * byte-compatible with a JS writer that keeps whatever it was given: narrowing to the typed
     * model on the way in would silently drop any field outside it on every read-modify-write.
     *
     * @param provider the provider id the pool is keyed by
     * @param account the raw account json map to add or merge in
     * @return which of add, update or no-op the write turned out to be
     */
    public Upsert upsertRaw(String provider, Map<String, Object> account) {
        Upsert[] outcome = { Upsert.ADDED };
        updateRaw(provider, accounts -> {
            String id = JsonUtil.asString(account.get("id"));
            String refresh = JsonUtil.asString(account.get("refresh"));
            int idx = -1;
            for (int i = 0; i < accounts.size(); i++) {
                Map<String, Object> existing = JsonUtil.asMap(accounts.get(i));
                if (existing == null) continue;
                boolean idMatch = id != null && id.equals(JsonUtil.asString(existing.get("id")));
                boolean refreshMatch = refresh != null && refresh.equals(JsonUtil.asString(existing.get("refresh")));
                if (idMatch || refreshMatch) {
                    idx = i;
                    break;
                }
            }
            if (idx < 0) {
                accounts.add(account);
                outcome[0] = Upsert.ADDED;
                return;
            }
            Map<String, Object> existing = JsonUtil.asMap(accounts.get(idx));
            Map<String, Object> merged = new LinkedHashMap<>(existing);
            merged.putAll(account);
            outcome[0] = stableJson(merged).equals(stableJson(existing)) ? Upsert.UNCHANGED : Upsert.UPDATED;
            accounts.set(idx, merged);
        });
        return outcome[0];
    }

    /**
     * Removes the account with this {@code id}, reporting whether one was there to remove.
     *
     * @param provider the provider id the pool is keyed by
     * @param id the account id to remove
     * @return whether an account with that id was there to remove
     */
    public boolean removeRaw(String provider, String id) {
        boolean[] removed = { false };
        updateRaw(provider, accounts -> {
            int before = accounts.size();
            accounts.removeIf(entry -> {
                Map<String, Object> m = JsonUtil.asMap(entry);
                return m != null && Objects.equals(id, JsonUtil.asString(m.get("id")));
            });
            removed[0] = accounts.size() != before;
        });
        return removed[0];
    }

    /**
     * The provider's pool sub-document as stored, with the three pool fields defaulted.
     *
     * @param provider the provider id the pool is keyed by
     * @return the pool sub-document, serialized as raw json
     */
    public String loadRaw(String provider) {
        Map<String, Object> providers = providersOf(parseOrDefault(store.get(KEY)));
        return json.stringify(rawPoolOf(providers, provider));
    }

    /**
     * Replaces the provider's pool sub-document with {@code poolJson}, leaving other providers be.
     *
     * @param provider the provider id the pool is keyed by
     * @param poolJson the raw pool sub-document to store, or {@code null} for an empty one
     */
    public void saveRaw(String provider, String poolJson) {
        store.update(KEY, current -> {
            Map<String, Object> doc = parseOrDefault(current);
            doc.put("version", 1);
            Map<String, Object> pool = JsonUtil.asMap(json.parse(poolJson == null ? "{}" : poolJson));
            providersOf(doc).put(provider, normalizedPool(pool));
            return json.stringify(doc);
        });
    }

    private void updateRaw(String provider, Consumer<List<Object>> mutator) {
        store.update(KEY, current -> {
            Map<String, Object> doc = parseOrDefault(current);
            doc.put("version", 1);
            Map<String, Object> providers = providersOf(doc);
            Map<String, Object> pool = rawPoolOf(providers, provider);
            // Copied rather than mutated in place: what the codec parsed need not be a mutable list.
            List<Object> accounts = new ArrayList<>(JsonUtil.asList(pool.get("accounts")));
            mutator.accept(accounts);
            pool.put("accounts", accounts);
            providers.put(provider, pool);
            return json.stringify(doc);
        });
    }

    private static Map<String, Object> rawPoolOf(Map<String, Object> providers, String provider) {
        return normalizedPool(JsonUtil.asMap(providers.get(provider)));
    }

    /** The stored pool with its three fields present, so a reader never has to default them again. */
    private static Map<String, Object> normalizedPool(Map<String, Object> stored) {
        Map<String, Object> pool = stored != null ? new LinkedHashMap<>(stored) : new LinkedHashMap<>();
        List<Object> accounts = JsonUtil.asList(pool.get("accounts"));
        pool.put("accounts", accounts != null ? accounts : new ArrayList<>());
        Integer activeIndex = JsonUtil.asInt(pool.get("activeIndex"));
        pool.put("activeIndex", activeIndex != null ? activeIndex : 0);
        Map<String, Object> lanes = JsonUtil.asMap(pool.get("activeIndexByLane"));
        pool.put("activeIndexByLane", lanes != null ? lanes : new LinkedHashMap<String, Object>());
        return pool;
    }

    /**
     * Content equality that ignores object key ORDER at every depth, so a re-upsert of the same
     * account with its nested objects serialized differently reads as unchanged. Array order is
     * real content and is left alone.
     */
    private String stableJson(Object value) {
        return json.stringify(sortKeysDeep(value));
    }

    private static Object sortKeysDeep(Object value) {
        Map<String, Object> asMap = JsonUtil.asMap(value);
        if (asMap != null) {
            List<String> keys = new ArrayList<>(asMap.keySet());
            Collections.sort(keys);
            Map<String, Object> sorted = new LinkedHashMap<>();
            for (String key : keys) sorted.put(key, sortKeysDeep(asMap.get(key)));
            return sorted;
        }
        List<Object> asList = JsonUtil.asList(value);
        if (asList != null) {
            List<Object> mapped = new ArrayList<>();
            for (Object entry : asList) mapped.add(sortKeysDeep(entry));
            return mapped;
        }
        return value;
    }

}
