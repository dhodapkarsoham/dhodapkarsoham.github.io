(() => {
  const input = document.querySelector("#post-search");
  if (!input) return;
  document.querySelector(".search").hidden = false;
  const posts = [...document.querySelectorAll("[data-search]")];
  const status = document.querySelector("#search-status");
  input.addEventListener("input", () => {
    const query = input.value.trim().toLocaleLowerCase();
    let count = 0;
    posts.forEach((post) => {
      post.hidden = !post.dataset.search.includes(query);
      if (!post.hidden) count++;
    });
    status.textContent = !query
      ? ""
      : count
        ? `${count} ${count === 1 ? "post" : "posts"} found.`
        : "No posts found. Try another topic or clear your search.";
  });
})();
