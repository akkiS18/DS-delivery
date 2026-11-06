namespace DsRestaurant.Core.Orders;

public class NewOrderAttention
{
    public const long DefaultSilenceMs = 30_000L;

    private readonly long _silenceMs;
    private readonly Dictionary<string, long> _silencedUntil = new();
    private HashSet<string> _waiting = new();

    public NewOrderAttention(long silenceMs = DefaultSilenceMs)
    {
        _silenceMs = silenceMs;
    }

    public IReadOnlySet<string> Update(IEnumerable<string> ids, long now)
    {
        _waiting = new HashSet<string>(ids);
        var toRemove = _silencedUntil.Keys.Where(k => !_waiting.Contains(k)).ToList();
        foreach (var key in toRemove)
        {
            _silencedUntil.Remove(key);
        }
        return Ringing(now);
    }

    public IReadOnlySet<string> Ringing(long now)
    {
        var result = new HashSet<string>();
        foreach (var id in _waiting)
        {
            if (!_silencedUntil.TryGetValue(id, out var until) || until <= now)
            {
                result.Add(id);
            }
        }
        return result;
    }

    public void Silence(long now)
    {
        foreach (var id in _waiting)
        {
            _silencedUntil[id] = now + _silenceMs;
        }
    }

    public IReadOnlySet<string> Pending() => _waiting;
}
