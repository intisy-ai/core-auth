package io.github.intisy.ai.js;

import org.teavm.jso.JSFunctor;
import org.teavm.jso.JSObject;
import org.teavm.jso.core.JSString;

/**
 * JS-provided synchronous availability predicate, bridging {@link
 * io.github.intisy.ai.shared.manager.ManagerOptions#extraAvailable} across the TeaVM boundary
 * for {@link CoreAuthJs#acquireAccount}. Mirrors {@link JsStoreBridge.JsStore}'s "sync, JSString
 * at the boundary" shape (no {@code @Async}/{@code AsyncCallback} needed, since {@code
 * Selection.selectIndex} calls this predicate synchronously mid-scan, same reasoning as {@link
 * JsStoreBridge}'s own javadoc) and {@link JsHttpClientBridge.JsHttpSend}'s single-method {@code
 * @JSFunctor} shape (this is a plain provider-supplied function, not a multi-method object).
 *
 * <p>The account crosses as a JSON string (built from the same field set {@code
 * AccountStore.accountToMap} serializes) rather than a per-field JSO overlay, so a provider
 * predicate can read whichever fields it needs (e.g. antigravity's {@code
 * account.meta.verificationRequired}) without a new overlay type per provider.
 */
public final class JsAvailabilityBridge {
    private JsAvailabilityBridge() {
    }

    /** A provider's isAvailable predicate, callable from Java across the TeaVM boundary. */
    @JSFunctor
    public interface JsAvailable extends JSObject {
        /**
         * Whether an account is available for a lane.
         *
         * @param accountJson the account, as JSON, in the shape {@code AccountStore.accountToMap} produces
         * @param lane the lane the caller is selecting an account for
         * @return true when the account is available
         */
        boolean test(JSString accountJson, JSString lane);
    }
}
