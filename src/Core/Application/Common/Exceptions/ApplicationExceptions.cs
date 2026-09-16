namespace Application.Common.Exceptions;

/// <summary>The requested entity does not exist inside the current tenant. Maps to HTTP 404.</summary>
public class NotFoundException : Exception
{
    public NotFoundException(string entity, object key)
        : base($"{entity} '{key}' was not found.") { }

    public NotFoundException(string message) : base(message) { }
}

/// <summary>Input failed an application-level rule. Maps to HTTP 400.</summary>
public class ValidationException : Exception
{
    public ValidationException(string message) : base(message)
        => Errors = new Dictionary<string, string[]>();

    public ValidationException(string field, string message) : base(message)
        => Errors = new Dictionary<string, string[]> { [field] = new[] { message } };

    public IDictionary<string, string[]> Errors { get; }
}

/// <summary>Conflicts with existing data, e.g. a duplicate slug or category name. Maps to HTTP 409.</summary>
public class ConflictException : Exception
{
    public ConflictException(string message) : base(message) { }
}

/// <summary>No tenant could be resolved for the request. Maps to HTTP 400.</summary>
public class TenantResolutionException : Exception
{
    public TenantResolutionException(string message) : base(message) { }
}
