namespace DsRestaurant.Core.Orders;

public interface IAlarmSink
{
    void StartRinging();
    void StopRinging();
    bool IsRinging { get; }
    void PlayTestSound();
}
