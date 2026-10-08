using Application.Features.Products;
using Infrastructure.Identity;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Api.Controllers;

[ApiController]
[Route("api/v1/products")]
[Produces("application/json")]
public sealed class ProductsController : ControllerBase
{
    private readonly IProductService _products;

    public ProductsController(IProductService products) => _products = products;

    /// <param name="categoryId">Optional filter.</param>
    /// <param name="includeInactive">
    /// Staff only. A customer scanning a QR code sees the sellable menu and nothing else.
    /// </param>
    [HttpGet]
    [AllowAnonymous]
    [ProducesResponseType(typeof(IReadOnlyList<ProductDto>), StatusCodes.Status200OK)]
    public async Task<ActionResult<IReadOnlyList<ProductDto>>> GetAll(
        [FromQuery] Guid? categoryId,
        [FromQuery] bool includeInactive,
        CancellationToken ct)
    {
        // Ignored rather than rejected for anonymous callers: a 403 here would turn a stray
        // query parameter into a broken menu. Hidden items are simply not theirs to see.
        var withInactive = includeInactive && User.Identity?.IsAuthenticated == true;

        return Ok(await _products.GetAllAsync(categoryId, withInactive, ct));
    }

    /// <summary>Staff only — the customer menu is served by the list endpoint above.</summary>
    [HttpGet("{id:guid}")]
    [Authorize(Policy = AuthPolicies.StaffMember)]
    [ProducesResponseType(typeof(ProductDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<ProductDto>> GetById(Guid id, CancellationToken ct)
        => Ok(await _products.GetByIdAsync(id, ct));

    [Authorize(Policy = AuthPolicies.ManageRestaurant)]
    [HttpPost]
    [ProducesResponseType(typeof(ProductDto), StatusCodes.Status201Created)]
    [ProducesResponseType(StatusCodes.Status409Conflict)]
    public async Task<ActionResult<ProductDto>> Create(CreateProductRequest request, CancellationToken ct)
    {
        var product = await _products.CreateAsync(request, ct);

        return CreatedAtAction(nameof(GetById), new { id = product.Id }, product);
    }

    [Authorize(Policy = AuthPolicies.ManageRestaurant)]
    [HttpPut("{id:guid}")]
    [ProducesResponseType(typeof(ProductDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<ProductDto>> Update(Guid id, UpdateProductRequest request, CancellationToken ct)
        => Ok(await _products.UpdateAsync(id, request, ct));

    [Authorize(Policy = AuthPolicies.ManageRestaurant)]
    [HttpDelete("{id:guid}")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    public async Task<IActionResult> Delete(Guid id, CancellationToken ct)
    {
        await _products.DeleteAsync(id, ct);

        return NoContent();
    }
}
