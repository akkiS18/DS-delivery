using DsTaxi.Core.Api;

namespace DsTaxi.Core.Dispatch;

/// <summary>
/// Decides when the program rings. Pure logic (no UI, no clock of its own), unit-tested. Port of core/AttentionTracker.kt.
///
/// A request "needs attention" while the operator has to answer it (new, late, or the system could not deliver it). Each such request is keyed by
/// id AND status, so a request that changes state rings again. "Silence" mutes the CURRENT ones for <c>silenceMs</c>; if the operator still has not
/// answered when that time is over, the program rings again - a silenced alarm must never be forgotten.
/// </summary>
public sealed class AttentionTracker
{
    public const long DefaultSilenceMs = 30_000;

    private readonly long _silenceMs;
    private readonly Dictionary<string, long> _silencedUntil = new();
    private HashSet<string> _attention = new();

    public AttentionTracker(long silenceMs = DefaultSilenceMs) => _silenceMs = silenceMs;

    public static string KeyOf(RequestDto r) => $"{r.Id}:{r.Status}";

    /// <summary>Feed the latest list of active requests. Returns the keys that should be ringing right now.</summary>
    public IReadOnlySet<string> Update(IEnumerable<RequestDto> requests, long now)
    {
        _attention = requests.Where(r => r.Attention).Select(KeyOf).ToHashSet();
        foreach (var key in _silencedUntil.Keys.Where(k => !_attention.Contains(k)).ToList()) _silencedUntil.Remove(key); // answered or changed: forget its silence
        return Ringing(now);
    }

    public IReadOnlySet<string> Ringing(long now) =>
        _attention.Where(k => !_silencedUntil.TryGetValue(k, out var until) || until <= now).ToHashSet();

    /// <summary>Mute everything that is waiting now.</summary>
    public void Silence(long now)
    {
        foreach (var key in _attention) _silencedUntil[key] = now + _silenceMs;
    }

    /// <summary>Keys still waiting for an answer (ringing or silenced).</summary>
    public IReadOnlySet<string> Pending() => _attention;
}
