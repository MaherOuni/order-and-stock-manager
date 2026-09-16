namespace Domain.Exceptions;

/// <summary>
/// Thrown when an invariant of the domain model would be violated.
/// Surfaces as HTTP 422 through the API exception middleware.
/// </summary>
public class DomainException : Exception
{
    public DomainException(string message) : base(message) { }
}
