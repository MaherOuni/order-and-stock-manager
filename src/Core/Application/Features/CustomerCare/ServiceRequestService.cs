using Application.Common.Exceptions;
using Application.Common.Interfaces;
using Application.Common.Tenancy;
using Domain.Entities;
using Domain.Enums;
using Microsoft.EntityFrameworkCore;

namespace Application.Features.CustomerCare;

public interface IServiceRequestService
{
    /// <summary>Raised by a customer: public, tenant named by slug.</summary>
    Task<ServiceRequestDto> RaiseAsync(CreateServiceRequestCommand command, CancellationToken ct = default);

    /// <summary>The floor view. Needs a resolved tenant (the staff header).</summary>
    Task<IReadOnlyList<ServiceRequestDto>> GetAsync(
        ServiceRequestStatus? status, int take, CancellationToken ct = default);

    Task<ServiceRequestDto> AcknowledgeAsync(Guid id, CancellationToken ct = default);

    Task<ServiceRequestDto> ResolveAsync(Guid id, CancellationToken ct = default);
}

public sealed class ServiceRequestService : IServiceRequestService
{
    private const int DefaultPageSize = 100;
    private const int MaxPageSize = 500;

    /// <summary>
    /// How long an identical open request from the same table is treated as the same shout.
    /// Tapping "call the waiter" three times is one person being impatient, not three tables.
    /// </summary>
    private static readonly TimeSpan DuplicateWindow = TimeSpan.FromMinutes(3);

    private readonly IApplicationDbContext _db;
    private readonly ICurrentTenant _currentTenant;
    private readonly ITenantBinder _tenantBinder;

    public ServiceRequestService(
        IApplicationDbContext db,
        ICurrentTenant currentTenant,
        ITenantBinder tenantBinder)
    {
        _db = db;
        _currentTenant = currentTenant;
        _tenantBinder = tenantBinder;
    }

    public async Task<ServiceRequestDto> RaiseAsync(
        CreateServiceRequestCommand command, CancellationToken ct = default)
    {
        await _tenantBinder.BindBySlugAsync(command.TenantSlug, ct);

        var since = DateTimeOffset.UtcNow - DuplicateWindow;

        var existing = await _db.ServiceRequests
            .Where(r => r.TableNumber == command.TableNumber.Trim()
                        && r.Kind == command.Kind
                        && r.Status != ServiceRequestStatus.Resolved
                        && r.CreatedAt >= since)
            .OrderByDescending(r => r.CreatedAt)
            .FirstOrDefaultAsync(ct);

        if (existing is not null) return Map(existing);

        var request = new ServiceRequest(command.TableNumber, command.Kind, command.Note, command.OrderId);

        _db.ServiceRequests.Add(request);
        await _db.SaveChangesAsync(ct);

        return Map(request);
    }

    public async Task<IReadOnlyList<ServiceRequestDto>> GetAsync(
        ServiceRequestStatus? status, int take, CancellationToken ct = default)
    {
        RequireTenant();

        var query = _db.ServiceRequests.AsNoTracking();

        if (status is { } wanted)
            query = query.Where(r => r.Status == wanted);

        var requests = await query
            // Oldest first: the table that has been waiting longest is the one to go to.
            .OrderBy(r => r.Status == ServiceRequestStatus.Resolved)
            .ThenBy(r => r.CreatedAt)
            .Take(PageSize(take))
            .ToListAsync(ct);

        return requests.Select(Map).ToList();
    }

    public Task<ServiceRequestDto> AcknowledgeAsync(Guid id, CancellationToken ct = default)
        => TransitionAsync(id, request => request.Acknowledge(), ct);

    public Task<ServiceRequestDto> ResolveAsync(Guid id, CancellationToken ct = default)
        => TransitionAsync(id, request => request.Resolve(), ct);

    private async Task<ServiceRequestDto> TransitionAsync(
        Guid id, Action<ServiceRequest> transition, CancellationToken ct)
    {
        RequireTenant();

        var request = await _db.ServiceRequests.FirstOrDefaultAsync(r => r.Id == id, ct)
                      ?? throw new NotFoundException(nameof(ServiceRequest), id);

        transition(request);

        await _db.SaveChangesAsync(ct);

        return Map(request);
    }

    private void RequireTenant()
    {
        if (!_currentTenant.IsResolved)
            throw new TenantResolutionException("Identify the restaurant with the X-Tenant-Id header.");
    }

    private static int PageSize(int take) => take switch
    {
        <= 0 => DefaultPageSize,
        > MaxPageSize => MaxPageSize,
        _ => take
    };

    private static ServiceRequestDto Map(ServiceRequest request) => new(
        request.Id,
        request.TableNumber,
        request.Kind,
        request.Note,
        request.OrderId,
        request.Status,
        request.CreatedAt,
        request.ResolvedAt);
}
