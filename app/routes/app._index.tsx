import { useEffect, useState } from "react";
import { Link } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData, Form, useActionData, useSubmit, useSearchParams } from "react-router";
import { authenticate } from "app/shopify.server";
import { getNotificationMessage } from "../services/notification.server";
// import { ToastContainer, toast } from "react-toastify";
// import "react-toastify/dist/ReactToastify.css";

interface ProductNode {
  id: string;
  title: string;
  status: string;
}

interface ProductEdge {
  node: ProductNode;
}

interface UserError {
  field?: string[];
  message: string;
}

// Fetch Product list (GraphQL Loader)
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  
  const url = new URL(request.url);

  const queryParam = url.searchParams.get("query") || "";
  const searchQuery = queryParam.trim() ? `title:*${queryParam.trim()}*` : "";

  const after = url.searchParams.get("after") || null;
  const before = url.searchParams.get("before") || null;

  const isPrevious = Boolean(before && !after);
  const paginationArgs = isPrevious ? { last: 10, before } : { first: 10, after };

  const response = await admin.graphql(
    `#graphql
    query getProducts($query: String, $first: Int, $after: String, $last: Int, $before: String) {
      products(query: $query, first: $first, after: $after, last: $last, before: $before) {
        pageInfo {
          hasNextPage
          hasPreviousPage
          startCursor
          endCursor
        }
        edges {
          cursor
          node {
            id
            title
            status
          }
        }
      }
    }`,
    // { variables: { query: searchQuery } }
    {
      variables: {
        query: searchQuery,
        ...paginationArgs
      }
    }
  );

  const responseJson = await response.json();

  return {
    products: (responseJson.data?.products?.edges || []) as ProductEdge[],
    pageInfo: responseJson.data.products?.pageInfo,
    queryParam
  };
};

// Handle Create, Update, and Delete Action
export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const actionType = formData.get("actionType") as string;

  // Create Product
  if (actionType === "CREATE") {
    const title = formData.get("title") as string;
    if (!title || title.trim() === "") {
      return { success: false, message: "Product title is required!" };
    }

    const trimmedTitle = title.trim();
    const escapedTitle = trimmedTitle.replace(/'/g, "\\'");

    const checkProductResponse = await admin.graphql(
      `#graphql
      query checkDuplicateProduct($query: String!) {
        products(first: 1, query: $query) {
          edges {
            node {
              id
              title
            }
          }
        }
      }`,
      { variables: { query: `title:'${escapedTitle}'` } }
    );

    const checkProductJson = await checkProductResponse.json();
    const existingProducts = checkProductJson.data.products.edges;

    if (existingProducts.length > 0) {
      return {
        success: false,
        message: `Warning: Product title "${trimmedTitle}" already exists!`,
      };
    }

    const createResponse = await admin.graphql(
      `#graphql
      mutation createProduct($product: ProductCreateInput!) {
        productCreate(product: $product) {
          product {
            id
            title
          }
          userErrors {
            field
            message
          }
        }
      }`,
      { variables: { product: { title: trimmedTitle } } }
    );

    const createJson = await createResponse.json();
    const createErrors: UserError[] = createJson.data?.productCreate?.userErrors ?? [];

    if (createErrors.length > 0) {
      return {
        success: false,
        message: createErrors.map((e) => e.message).join(", "),
      };
    }

    // return { success: true, message: "Product Created Successfully!" };
    const toastMsg = await getNotificationMessage(session.shop, "createMsg");
    return { success: true, message: toastMsg };
  }

  // Update Status
  if (actionType === "UPDATE_STATUS") {
    const productId = formData.get("productId") as string;
    const currentStatus = formData.get("currentStatus") as string;
    const newStatus = currentStatus === "ACTIVE" ? "DRAFT" : "ACTIVE";

    // FIX: updates now use "product: ProductUpdateInput!" (not "input: ProductInput!")
    const updateResponse = await admin.graphql(
      `#graphql
      mutation updateProduct($product: ProductUpdateInput!) {
        productUpdate(product: $product) {
          product {
            id
            status
          }
          userErrors {
            field
            message
          }
        }
      }`,
      { variables: { product: { id: productId, status: newStatus } } }
    );

    const updateJson = await updateResponse.json();
    const updateErrors: UserError[] = updateJson.data?.productUpdate?.userErrors ?? [];

    if (updateErrors.length > 0) {
      return {
        success: false,
        message: updateErrors.map((e) => e.message).join(", "),
      };
    }

    // return { success: true, message: `Status changed to ${newStatus}!` };
    const toastMsg = await getNotificationMessage(session.shop, "statusMsg");
    return { success: true, message: toastMsg };
  }

  // Delete Product
  if (actionType === "DELETE") {
    const productId = formData.get("productId") as string;

    const deleteResponse = await admin.graphql(
      `#graphql
      mutation deleteProduct($id: ID!) {
        productDelete(input: { id: $id }) {
          deletedProductId
          userErrors {
            field
            message
          }
        }
      }`,
      { variables: { id: productId } }
    );

    const deleteJson = await deleteResponse.json();
    const deleteErrors: UserError[] = deleteJson.data?.productDelete?.userErrors ?? [];

    if (deleteErrors.length > 0) {
      return {
        success: false,
        message: deleteErrors.map((e) => e.message).join(", "),
      };
    }

    // return { success: true, message: "Product Deleted Successfully!" };
    const toastMsg = await getNotificationMessage(session.shop, "deleteMsg");
    return { success: true, message: toastMsg };
  }

  return null;
};

// Web Components Frontend
export default function Index() {
  const { products, queryParam, pageInfo } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();
  const [searchParams] = useSearchParams();
  const [searchTerm, setSearchTerm] = useState(queryParam || "");
  // const [searchQuery, setSearchQuery] = useState("");

  // const filteredProducts = products.filter(({node}) => 
  //   node.title.toLowerCase().includes(searchQuery.toLowerCase())
  // );

  const handleNextPage= () => {
    if(pageInfo.hasNextPage && pageInfo.endCursor) {
      const formData = new FormData();
      formData.append("after", pageInfo.endCursor);
      submit(formData, {method: "get", replace: true});
    }
  }
  
  const handlePreviousPage= () => {
    if(pageInfo.hasPreviousPage && pageInfo.startCursor) {
      const formData = new FormData();
      formData.append("before", pageInfo.startCursor);
      submit(formData, {method: "get", replace: true});
    }
  }

  useEffect(() => {

    if (actionData?.message) {
      if (typeof shopify !== "undefined" && shopify.toast) {  
        shopify.toast.show(actionData.message, {
          duration: 3000,
          isError: !actionData.success,
        });      
      }
    }
    // if (actionData?.message) {
    //   if (actionData.success) {
    //     toast.success(actionData.message);
    //   } else {
    //     toast.error(actionData.message);
    //   }
    // }

    const timer = setTimeout(() => {
      if (searchTerm !== (searchParams.get("query") || "")) {
        const formData = new FormData();
        formData.append("query", searchTerm);
        
        submit(formData, { method: "get", replace: true });
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [actionData, searchTerm, submit, searchParams]);

  const handleDeleteConfirm = (productId: string) => {
    const formData = new FormData();
    formData.append("actionType", "DELETE");
    formData.append("productId", productId);
    submit(formData, { method: "post" });
  };

  return (
    
    <s-page heading="Product Manager">
      <s-button>
        <Link to="/app/settings" style={{ textDecoration: 'none', color: 'inherit' }}>
          Go to Settings
        </Link>
      </s-button>      
      <s-button>
        <Link to="/app/reviews" style={{ textDecoration: 'none', color: 'inherit' }}>
          Go to Reviews
        </Link>
      </s-button>      
      
      {/* <ToastContainer position="top-right" autoClose={3000} /> */}
 
      <s-section heading="Create new Product">
        <s-box>
          <Form method="post">
            <input type="hidden" name="actionType" value="CREATE" />
            <s-stack direction="block" gap="base">
              <div style={{display: "flex", flexDirection: "column", gap: "10px"}}>
                  <s-text>Product Title</s-text>
                  <s-text-field
                    name="title"
                    placeholder="Enter product title"
                  />
              </div>
              <s-stack direction="inline" justifyContent="end">
                <s-button type="submit" variant="primary">
                  Create Product
                </s-button>
              </s-stack>
            </s-stack>
          </Form>
        </s-box>
      </s-section>
 
      <s-section heading={`Store Products (${products.length})`} padding="base">
        
        <s-table>
          <s-search-field
            slot="filters"
            placeholder="Search products"
            value={searchTerm}
            onInput={(e: any) => setSearchTerm(e.target.value)}
          />
          {/* <s-search-field 
            slot="filters" 
            label="Search products" 
            labelAccessibilityVisibility="exclusive" 
            placeholder="Search products"
            value={searchQuery}
            onInput={(e: any) => setSearchQuery(e.target.value)}
          /> */}
          <s-table-header-row>
            <s-table-header listSlot="primary">Product Title</s-table-header>
            <s-table-header>Status</s-table-header>
            <s-table-header>Change Status</s-table-header>
            <s-table-header>Actions</s-table-header>
          </s-table-header-row>
          <s-table-body>
            {/* {filteredProducts.length > 0 ? (
              filteredProducts.map(({ node }) => (
                <s-table-row key={node.id}>
                  <s-table-cell>
                    <s-text type="strong">{node.title}</s-text>
                  </s-table-cell>
                  <s-table-cell>
                    <s-badge tone={node.status === "ACTIVE" ? "success" : "warning"}>
                      {node.status}
                    </s-badge>
                  </s-table-cell>
                  <s-table-cell>
                    <s-stack direction="inline" gap="small" alignItems="center">
                      <Form method="post">
                        <input type="hidden" name="actionType" value="UPDATE_STATUS" />
                        <input type="hidden" name="productId" value={node.id} />
                        <input type="hidden" name="currentStatus" value={node.status} />
                        <s-button type="submit" variant="tertiary">
                          Toggle Status
                        </s-button>
                      </Form>
                    </s-stack>
                  </s-table-cell>

                  <s-table-cell>  
                    <s-stack>
                      <s-button
                        variant="tertiary"
                        tone="critical"
                        commandFor={`delete-modal-${node.id}`}
                        command="--show"
                      >
                        Delete
                      </s-button>
                    </s-stack>

                    <s-modal id={`delete-modal-${node.id}`} heading="Delete Product">
                      <s-text>
                        Are you sure you want to delete <strong>{node.title}</strong>? This action cannot be undone.
                      </s-text>
                      <s-button
                        slot="secondary-actions"
                        variant="secondary"
                        commandFor={`delete-modal-${node.id}`}
                        command="--hide"
                      >
                        Cancel
                      </s-button>
                      <s-button
                        slot="primary-action"
                        variant="primary"
                        tone="critical"
                        commandFor={`delete-modal-${node.id}`}
                        command="--hide"
                        onClick={() => handleDeleteConfirm(node.id)}
                      >
                        Yes, Delete
                      </s-button>
                    </s-modal>
                  </s-table-cell>
                </s-table-row>
              ))
            ) : (
              <tr>
                <td colSpan={3} style={{ textAlign: "center", padding: "16px" }}>
                  No products found matching {searchQuery}
                </td>
              </tr>
            )} */}
            {products.length > 0 ? (
              products.map(({ node }) => (
                <s-table-row key={node.id}>
                  <s-table-cell>
                    <s-text type="strong">{node.title}</s-text>
                  </s-table-cell>
                  <s-table-cell>
                    <s-badge tone={node.status === "ACTIVE" ? "success" : "warning"}>
                      {node.status}
                    </s-badge>
                  </s-table-cell>
                  <s-table-cell>
                    <s-stack direction="inline" gap="small" alignItems="center">
                      <Form method="post">
                        <input type="hidden" name="actionType" value="UPDATE_STATUS" />
                        <input type="hidden" name="productId" value={node.id} />
                        <input type="hidden" name="currentStatus" value={node.status} />
                        <s-button type="submit" variant="tertiary">
                          Toggle Status
                        </s-button>
                      </Form>
                    </s-stack>
                  </s-table-cell>

                  <s-table-cell>  
                    <s-stack>
                      <s-button
                        variant="tertiary"
                        tone="critical"
                        commandFor={`delete-modal-${node.id}`}
                        command="--show"
                      >
                        Delete
                      </s-button>
                    </s-stack>

                    <s-modal id={`delete-modal-${node.id}`} heading="Delete Product">
                      <s-text>
                        Are you sure you want to delete <strong>{node.title}</strong>? This action cannot be undone.
                      </s-text>
                      <s-button
                        slot="secondary-actions"
                        variant="secondary"
                        commandFor={`delete-modal-${node.id}`}
                        command="--hide"
                      >
                        Cancel
                      </s-button>
                      <s-button
                        slot="primary-action"
                        variant="primary"
                        tone="critical"
                        commandFor={`delete-modal-${node.id}`}
                        command="--hide"
                        onClick={() => handleDeleteConfirm(node.id)}
                      >
                        Yes, Delete
                      </s-button>
                    </s-modal>
                  </s-table-cell>
                </s-table-row>
              ))
            ) : (
              <tr>
                <td colSpan={3} style={{ textAlign: "center", padding: "16px" }}>
                  No products found matching {searchTerm}
                </td>
              </tr>
            )}
            
          </s-table-body>
        </s-table>
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: "8px",
            marginTop: "16px",
            paddingTop: "16px",
            borderTop: "1px solid #e1e3e5",
          }}
        >
          <s-button
            onClick={handlePreviousPage}
            disabled={!pageInfo.hasPreviousPage}
          >
            Previous
          </s-button>
          <s-button
            onClick={handleNextPage}
            disabled={!pageInfo.hasNextPage}
          >
            Next
          </s-button>
        </div>
      </s-section>
    </s-page>
  );
}

// import { useEffect, useState } from "react";
// import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
// import { useLoaderData, Form, useActionData, useSubmit } from "react-router";
// import { authenticate } from "app/shopify.server";
// import {
//   Page,
//   Layout,
//   Card,
//   Button,
//   TextField,
//   DataTable,
//   Badge,
//   BlockStack,
//   InlineStack,
//   Text,
//   Modal,
// } from "@shopify/polaris";
// import { ToastContainer, toast } from "react-toastify";
// import "react-toastify/dist/ReactToastify.css";

// interface ProductNode {
//   id: string;
//   title: string;
//   status: string;
// }

// interface ProductEdge {
//   node: ProductNode
// }

// //Fetch Product list
// export const loader = async ({ request }: LoaderFunctionArgs) => {
//   const { admin } = await authenticate.admin(request);

//   const response = await admin.graphql(
//     `#graphql
//     query getProducts {
//       products(first: 100) {
//         edges {
//           node {
//             id
//             title
//             status
//           }
//         }
//       }
//     }`
//   );

//   const responseJson = await response.json();

//   return {
//     products: responseJson.data.products.edges as ProductEdge[],
//   };
// };


// // Handle Create, update and delete action 
// export const action = async ({ request }: ActionFunctionArgs) => {
//   const { admin }  = await authenticate.admin(request);
//   const formData = await request.formData();
//   const actionType = formData.get("actionType") as string;

//   //Create Product
//   if(actionType === "CREATE") {
    
//     const title = formData.get("title") as string;
//     if(!title || title.trim() === ""){
//       return {  success: false, message: "Product title is required!"};
//     }

//     const checkProductResponse = await admin.graphql(
//       `#graphql
//       query checkDuplicateProduct($query: String!) {
//         products(first: 1, query: $query) {
//           edges {
//             node {
//               id
//               title
//             }
//           }
//         }
//       }`,
//       { variables: { query: `title:'${title.trim()}'` } }
//     );

//     const checkProductJson = await checkProductResponse.json();
//     const existingProducts = checkProductJson.data.products.edges;

//     if (existingProducts.length > 0) {
//       return {
//         success: false,
//         message: `Warning: Product title "${title}" already exists!`,
//       };
//     }

//     await admin.graphql(
//       `#graphql
//       mutation createProduct($input: ProductInput!) {
//         productCreate(input: $input) {
//           product {
//             id
//             title
//           }
//         }
//       }`,
//       { variables: { input: { title: title.trim() } } }
//     );
//     return { success: true, message: "Product Created Successfully!"};
//   }

//   //update status
//   if(actionType === "UPDATE_STATUS") {
//     const productId = formData.get("productId") as string;
//     const currentStatus = formData.get("currentStatus") as string;
//     const newStatus = currentStatus === "ACTIVE" ? "DRAFT" : "ACTIVE";

//     await admin.graphql(
//       `#graphql
//       mutation updateProduct($input: ProductInput!){
//         productUpdate(input: $input) {
//             product  {
//               id 
//               status
//             }
//         }
//       }`,
//       { variables: { input: { id: productId, status: newStatus} } }
//     );
//     return  { success: true, message: `Status changed to ${newStatus}!` };
//   }

//   //Delete product
//   if(actionType === "DELETE") {
//     const productId = formData.get("productId") as string;

//     await admin.graphql(
//       `#graphql
//       mutation deleteProduct($id: ID!) {
//         productDelete(input: { id: $id }) {
//           deletedProductId
//           userErrors {
//             field
//             message
//           }
//         }
//       }`,
//       { variables: { id: productId } }
//     );
//     return { success: true, message: "Product Deleted Successfully!"};
//   }
//   return null;
// }

// // Frontend
// export default function Index() {
//   const { products } = useLoaderData<typeof loader>();
//   const actionData = useActionData<typeof action>();
//   const submit = useSubmit();

//   const [title, setTitle] = useState("");
//   const [selectedProduct, setSelectedProduct] = useState<{ id: string; title: string } | null>(null);
  
//   useEffect(() => {
//     if (actionData?.message) {
//       if (actionData.success) {
//         toast.success(actionData.message);
//         setTitle("");
//       } else {
//         toast.error(actionData.message);
//       }
//     }
//   }, [actionData]);

//   const handleDeleteConfirm = () => {
//     if (selectedProduct) {
//       const formData = new FormData();
//       formData.append("actionType", "DELETE");
//       formData.append("productId", selectedProduct.id);
//       submit(formData, { method: "post" });
//       setSelectedProduct(null);
//     }
//   };

//   const tableRows = products.map(({node}) => [
//     node.title,
//     <Badge key={node.id} tone={node.status === "ACTIVE" ? "success" : "attention"}>
//       {node.status}
//     </Badge>,
//     <InlineStack key={node.id}>
//       <Form method="post">
//         <input type="hidden" name="actionType" value="UPDATE_STATUS"/>
//         <input type="hidden" name="productId" value={node.id}/>
//         <input type="hidden" name="currentStatus" value={node.status}/>
//         <Button submit size="micro">
//           Toggle Status
//         </Button>
//       </Form>

//       <Button 
//         tone="critical"
//         size="micro"
//         onClick={() => setSelectedProduct({ id: node.id, title: node.title })}
//       >
//         Delete
//       </Button>   
//     </InlineStack>,
//   ]);

//   return (

//     <Page title="Product Manager" subtitle="Create, Update and Delete Products seamlessly">
//       <ToastContainer position="top-right" autoClose={3000} />
//       <Layout>
//         <Layout.Section>
//           <Card>
//             <BlockStack gap="400">
//               <Text as="h2" variant="headingMd">
//                 Create new Product
//               </Text>
//               <Form method="post">
//                 <input type="hidden" name="actionType" value="CREATE"/>
//                 <BlockStack gap="400">
//                   <TextField
//                     label="Product Title"
//                     name="title"
//                     value={title}
//                     onChange={(val) => setTitle(val)}
//                     autoComplete="off"
//                     placeholder="Enter product title"
//                   />
//                   <InlineStack align="end">
//                     <Button submit variant="primary">
//                       Create Product
//                     </Button>
//                   </InlineStack>
//                 </BlockStack>
//               </Form>
//             </BlockStack>
//           </Card>
//         </Layout.Section>

//         <Layout.Section>
//           <Card>
//             <BlockStack gap="400">
//               <Text as="h2">
//                 Store Products ({products.length})
//               </Text>
//               <DataTable
//                 columnContentTypes={["text", "text", "text"]}
//                 headings={["Product Title", "Status", "Actions"]}
//                 rows={tableRows}
//               />
//             </BlockStack>
//           </Card>
//         </Layout.Section>
//       </Layout>

//       <Modal
//         open={Boolean(selectedProduct)}
//         onClose={()=>setSelectedProduct(null)}
//         title="Delete Product"
//         primaryAction={{
//           content: "Yes, Delete",
//           destructive: true,
//           onAction: handleDeleteConfirm
//         }}
//         secondaryActions={[
//           {
//             content: "Cancel",
//             onAction: () => setSelectedProduct(null)
//           }
//         ]}
//       >
//         <Modal.Section>
//           <Text as="p">
//             Are you sure you want to delete <strong>{selectedProduct?.title}</strong>? This action cannot be undone.
//           </Text>
//         </Modal.Section>
//       </Modal>

//     </Page>

    // <div style={{ padding: "20px", fontFamily: "sans-serif", maxWidth: "100%", background: "#ffffff" }}>
    //     <ToastContainer position="top-right" autoClose={3000} hideProgressBar={false} />
    //     <h1>Product Create, Update, Delete, Status</h1>
    //     {/* Notification Message */}
    //     {actionData?.message && (
    //       <p style={{ background: actionData.success ? "#e6fffa" : "#ffe6e6", padding: "12px", border: "1px solid"}}>
    //         {actionData.message}
    //       </p>
    //     )}

    //     {/* Create Product Form */}
    //     <div style={{background: "#f5f5f5", padding: "12px"}}>
    //       <h3 style={{margin: "0 0 12px 0"}}>Create New Product</h3>
    //       <Form ref={formRef} method="post" style={{display: "flex", gap: "6px"}}>
    //         <input type="hidden" name="actionType" value="CREATE"/>
    //         <input type="text" name="title" placeholder="Your Product Title" style={{padding: "8px 10px"}} />
    //         <button type="submit" style={{padding: "6px 8px", background: "#f9f9f9", color: "#000"}}>Create</button>
    //       </Form>
    //     </div>

    //     {/* Product list with update and delete */}
    //     <div style={{padding: "12px", background: "#f5f5f5"}}>
    //       <h2 style={{margin: "0 0 12px 0"}}>Store Products</h2>
    //       <ul style={{listStyle: "none", padding: 0}}>

    //         {products.map(({node}) =>
    //           <li key={node.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: "1px solid #ccc" }}>
    //             <div>
    //               <strong>{node.title}</strong> - <span>{node.status}</span>
    //             </div>

    //             <div style={{ display: "flex", gap: "10px" }}>
    //               {/* Status Update Form */}
    //               <Form method="post">
    //                 <input type="hidden" name="actionType" value="UPDATE_STATUS" />
    //                 <input type="hidden" name="productId" value={node.id} />
    //                 <input type="hidden" name="currentStatus" value={node.status} />
    //                 <button type="submit" style={{ padding: "4px 8px", cursor: "pointer" }}>
    //                   Toggle Status
    //                 </button>
    //               </Form>

    //               {/* Delete Form */}
    //               <Form method="post">
    //                 <input type="hidden" name="actionType" value="DELETE" />
    //                 <input type="hidden" name="productId" value={node.id} />
    //                 {/* <button type="submit" style={{ padding: "4px 8px", color: "red", cursor: "pointer" }}>
    //                   Delete
    //                 </button> */}
    //                 <button
    //                   type="button"
    //                   onClick={() => setSelectedProduct({ id: node.id, title: node.title })}
    //                   style={{ padding: "4px 8px", color: "red", cursor: "pointer" }}
    //                 >
    //                   Delete
    //                 </button>
    //               </Form>
    //             </div>
    //           </li>
    //         )}

    //       </ul>
    //     </div>

    //     {selectedProduct && (
    //       <div style={{
    //         position: "fixed",
    //         top: 0, left: 0, right: 0, bottom: 0,
    //         background: "rgba(0, 0, 0, 0.5)",
    //         display: "flex",
    //         alignItems: "center",
    //         justifyContent: "center",
    //         zIndex: 1000
    //       }}>
    //         <div style={{ background: "#ffffff", padding: "20px", borderRadius: "8px", maxWidth: "400px", width: "100%" }}>
    //           <h3 style={{ marginTop: 0 }}>Delete Product?</h3>
    //           <p>Are you sure you want to delete <strong>{selectedProduct.title}</strong>? This action cannot be undone.</p>
              
    //           <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "20px" }}>
        
    //             <button 
    //               type="button" 
    //               onClick={() => setSelectedProduct(null)} 
    //               style={{ padding: "6px 12px", cursor: "pointer" }}
    //             >
    //               Cancel
    //             </button>

             
    //             <Form method="post" onSubmit={() => setSelectedProduct(null)}>
    //               <input type="hidden" name="actionType" value="DELETE" />
    //               <input type="hidden" name="productId" value={selectedProduct.id} />
    //               <button 
    //                 type="submit" 
    //                 style={{ padding: "6px 12px", background: "red", color: "white", border: "none", borderRadius: "4px", cursor: "pointer" }}
    //               >
    //                 Yes, Delete
    //               </button>
    //             </Form>
    //           </div>
    //         </div>
    //       </div>
    //     )}
    // </div>
//   );
// }

/**
 // Data Creation (Create):
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData, Form, useActionData } from "react-router";
import { authenticate } from "../shopify.server";

interface ProductNode {
  id: string;
  title: string;
  status: string;
}

interface ProductEdge {
  node: ProductNode;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);

  const response = await admin.graphql(
    `#graphql
    query getProducts {
      products(first: 5) {
        edges {
          node {
            id
            title
            status
          }
        }
      }
    }`
  );

  const responseJson = await response.json();

  return {
    loaderDebug: responseJson,
    products: responseJson.data.products.edges as ProductEdge[],
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const title = formData.get("title") as string;

  if (!title) {
    return { success: false, error: "Product title is required!", actionDebug: null, newProduct: null };
  }

  // GraphQL Mutation
  const response = await admin.graphql(
    `#graphql
    mutation createProduct($input: ProductInput!) {
      productCreate(input: $input) {
        product {
          id
          title
        }
        userErrors {
          field
          message
        }
      }
    }`,
    {
      variables: {
        input: {
          title: title,
        },
      },
    }
  );

  const responseJson = await response.json();

  return {
    actionDebug: responseJson,
    success: true,
    error: null,
    newProduct: responseJson.data?.productCreate?.product || null,
  };
};

// UI Component
export default function Index() {
  const { loaderDebug, products } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();

  return (
    <div style={{ padding: "20px", fontFamily: "sans-serif", maxWidth: "600px" }}>
      <h1>Custom App Dashboard</h1>

      <div style={{ background: "#f4f4f4", padding: "15px", borderRadius: "8px", marginBottom: "20px" }}>
        <h3>Add New Product</h3>
        <Form method="post" style={{ display: "flex", gap: "10px" }}>
          <input
            type="text"
            name="title"
            placeholder="Product Title"
            style={{ padding: "8px", flex: 1 }}
          />
          <button type="submit" style={{ padding: "8px 16px", cursor: "pointer" }}>
            Create Product
          </button>
        </Form>
        {actionData?.success && actionData.newProduct && (
          <p style={{ color: "green" }}>Product Created: {actionData.newProduct.title}</p>
        )}
        {actionData?.error && <p style={{ color: "red" }}>{actionData.error}</p>}
      </div>

      <h2>Store-এর Product List:</h2>
      <ul>
        {products.map(({ node }) => (
          <li key={node.id}>
            <strong>{node.title}</strong> — Status: {node.status}
          </li>
        ))}
      </ul>

      <hr style={{ margin: "30px 0" }} />

      <h2>Raw API Response</h2>
      <pre 
        style={{ 
          background: "#1e1e1e", 
          color: "#00ff66", 
          padding: "15px", 
          borderRadius: "8px", 
          overflowX: "auto" 
        }}
      >
        {JSON.stringify(actionData?.actionDebug || loaderDebug, null, 2)}
      </pre>
    </div>
  );
}
*/


/**
// Data Fetching (Read):
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";

// Interfaces
interface ProductNode {
  id: string;
  title: string;
  status: string;
  productType: string;
  featuredImage?: {
    url: string;
    altText?: string;
  };
  options: Array<{
    id: string;
    name: string;
    values: string[];
  }>;
  variants: {
    edges: Array<{
      node: {
        id: string;
        title: string;
        price: string;
        sku?: string;
      };
    }>;
  };
}

interface ProductEdge {
  node: ProductNode;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);

  const response = await admin.graphql(
    `#graphql
    query getProducts {
      products(first: 5) {
        edges {
          node {
            id
            title
            status
            productType
            featuredImage {
              url
              altText
            }
            options {
              id
              name
              values
            }
            variants(first: 5) {
              edges {
                node {
                  id
                  title
                  price
                  sku
                }
              }
            }
          }
        }
      }
    }`
  );

  const responseJson = await response.json();

  return {
    debugResponse: responseJson,
    products: responseJson.data.products.edges as ProductEdge[],
  };
};

export default function Index() {
  const { products, debugResponse } = useLoaderData<typeof loader>();

  return (
    <div style={{ padding: "20px", fontFamily: "sans-serif" }}>
      <h1>Custom App Dashboard (TypeScript)</h1>
      <h2>Store-এর Product List:</h2>
      
      <ul>
        {products.map(({ node }) => (
          <li key={node.id} style={{ marginBottom: "20px" }}>
            <strong>{node.title}</strong> — Status: {node.status}
            
            {node.featuredImage && (
              <div>
                <img 
                  src={node.featuredImage.url} 
                  alt={node.featuredImage.altText || node.title} 
                  width="60" 
                  style={{ borderRadius: "4px", marginTop: "5px" }}
                />
              </div>
            )}

            {node.options && (
              <div>
                <small><strong>Options:</strong> {node.options.map(o => `${o.name}: [${o.values.join(", ")}]`).join(" | ")}</small>
              </div>
            )}

            {node.variants && (
              <div>
                <small><strong>Variants:</strong></small>
                <ul>
                  {node.variants.edges.map(({ node: variant }) => (
                    <li key={variant.id}>
                      <small>{variant.title} - ${variant.price}</small>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </li>
        ))}
      </ul>

      <hr style={{ margin: "30px 0" }} />

      <h2>Raw API Response</h2>
      <pre 
        style={{ 
          background: "#1e1e1e", 
          color: "#00ff66", 
          padding: "15px", 
          borderRadius: "8px", 
          overflowX: "auto" 
        }}
      >
        {JSON.stringify(debugResponse, null, 2)}
      </pre>
    </div>
  );
}
*/
