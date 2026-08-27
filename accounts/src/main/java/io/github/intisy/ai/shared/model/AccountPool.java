package io.github.intisy.ai.shared.model;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * The JS {@code AccountPool} (see {@code libs/core-auth/src/types.ts}) in Java. Field order is
 * the serialized key order, which a JS reader of the same file depends on.
 */
public class AccountPool {
    /** The provider's accounts, in catalog order. */
    public List<Account> accounts;
    /** Sticky selection into {@link #accounts} used when no lane is given. */
    public int activeIndex;
    /** Sticky selection into {@link #accounts} per lane, for callers that select by lane. */
    public Map<String, Integer> activeIndexByLane;

    /** Constructs an empty pool. */
    public AccountPool() {
        this.accounts = new ArrayList<>();
        this.activeIndex = 0;
        this.activeIndexByLane = new LinkedHashMap<>();
    }

    /**
     * @param accounts the provider's accounts, defaulted to empty when {@code null}
     * @param activeIndex the sticky selection used when no lane is given
     * @param activeIndexByLane the sticky selection per lane, defaulted to empty when {@code null}
     */
    public AccountPool(List<Account> accounts, int activeIndex, Map<String, Integer> activeIndexByLane) {
        this.accounts = accounts != null ? accounts : new ArrayList<>();
        this.activeIndex = activeIndex;
        this.activeIndexByLane = activeIndexByLane != null ? activeIndexByLane : new LinkedHashMap<>();
    }
}
